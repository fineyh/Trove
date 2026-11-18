//! HEIC through the system decoder (ADR-060).
//!
//! WebView2 can't show HEIC. Windows can, when the HEIF Image Extension and
//! HEVC Video Extension are installed — the same pieces the Photos app uses,
//! and the HEVC part runs on the GPU. We ask WIC for the pixels and hand them
//! back as an uncompressed BMP: no encode step here, and the WebView decodes
//! a BMP almost for free.
//!
//! Without the extensions (or off Windows) this returns an error and the
//! front end falls back to its WASM decoder.

use std::path::Path;

/// A decoded picture: the BMP bytes, and the original's upright size (the
/// BMP may be smaller when `max_edge` asked for it).
pub struct Decoded {
    pub bmp: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[cfg(windows)]
pub fn decode_bmp(path: &Path, max_edge: Option<u32>) -> Result<Decoded, String> {
    imp::decode_bmp(path, max_edge).map_err(|e| e.message())
}

#[cfg(not(windows))]
pub fn decode_bmp(_path: &Path, _max_edge: Option<u32>) -> Result<Decoded, String> {
    Err("no system HEIC decoder".into())
}

/// Size after fitting `w`×`h` inside `max` on the long edge (never upscales).
fn fit(w: u32, h: u32, max: u32) -> (u32, u32) {
    let long = w.max(h);
    if max == 0 || long <= max {
        return (w, h);
    }
    let s = max as f64 / long as f64;
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

/// A top-down 24-bit BMP around rows that are already BGR, 4-byte padded.
fn bmp_header(w: u32, h: u32, data_len: usize) -> [u8; 54] {
    let mut b = [0u8; 54];
    let file_len = 54 + data_len as u32;
    b[0..2].copy_from_slice(b"BM");
    b[2..6].copy_from_slice(&file_len.to_le_bytes());
    b[10..14].copy_from_slice(&54u32.to_le_bytes());
    b[14..18].copy_from_slice(&40u32.to_le_bytes());
    b[18..22].copy_from_slice(&(w as i32).to_le_bytes());
    // Negative height = rows run top to bottom, as WIC gives them.
    b[22..26].copy_from_slice(&(-(h as i32)).to_le_bytes());
    b[26..28].copy_from_slice(&1u16.to_le_bytes());
    b[28..30].copy_from_slice(&24u16.to_le_bytes());
    b[34..38].copy_from_slice(&(data_len as u32).to_le_bytes());
    b
}

fn stride(w: u32) -> u32 {
    (w * 3 + 3) & !3
}

#[cfg(windows)]
mod imp {
    use super::{bmp_header, fit, stride, Decoded};
    use std::cell::RefCell;
    use std::path::Path;
    use windows::core::{Interface, Result, HSTRING, PCWSTR};
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Graphics::Imaging::*;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VT_UI2;

    thread_local! {
        static FACTORY: RefCell<Option<IWICImagingFactory>> = const { RefCell::new(None) };
    }

    fn factory() -> Result<IWICImagingFactory> {
        FACTORY.with(|f| {
            if let Some(x) = f.borrow().as_ref() {
                return Ok(x.clone());
            }
            // Our own worker threads: join the MTA once. A thread that is
            // already in an apartment just keeps it.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let x: IWICImagingFactory =
                unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)? };
            *f.borrow_mut() = Some(x.clone());
            Ok(x)
        })
    }

    /// EXIF-style orientation (1–8). The HEIF decoder hands back pixels as
    /// stored; turning them upright is ours to do.
    fn orientation(frame: &IWICBitmapFrameDecode) -> u16 {
        let Ok(reader) = (unsafe { frame.GetMetadataQueryReader() }) else {
            return 1;
        };
        for q in ["System.Photo.Orientation", "/ifd/{ushort=274}"] {
            let mut pv = PROPVARIANT::default();
            let name = HSTRING::from(q);
            if unsafe { reader.GetMetadataByName(PCWSTR(name.as_ptr()), &mut pv) }.is_ok() {
                let v = unsafe {
                    let inner = &pv.Anonymous.Anonymous;
                    (inner.vt == VT_UI2).then(|| inner.Anonymous.uiVal)
                };
                unsafe {
                    let _ = PropVariantClear(&mut pv);
                }
                if let Some(v @ 1..=8) = v {
                    return v;
                }
            }
        }
        1
    }

    fn transform(o: u16) -> WICBitmapTransformOptions {
        match o {
            2 => WICBitmapTransformFlipHorizontal,
            3 => WICBitmapTransformRotate180,
            4 => WICBitmapTransformFlipVertical,
            5 => WICBitmapTransformOptions(WICBitmapTransformRotate90.0 | WICBitmapTransformFlipHorizontal.0),
            6 => WICBitmapTransformRotate90,
            7 => WICBitmapTransformOptions(WICBitmapTransformRotate270.0 | WICBitmapTransformFlipHorizontal.0),
            8 => WICBitmapTransformRotate270,
            _ => WICBitmapTransformRotate0,
        }
    }

    pub fn decode_bmp(path: &Path, max_edge: Option<u32>) -> Result<Decoded> {
        let f = factory()?;
        let wpath = HSTRING::from(path.as_os_str());
        unsafe {
            let dec = f.CreateDecoderFromFilename(
                PCWSTR(wpath.as_ptr()),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )?;
            let frame = dec.GetFrame(0)?;
            let o = orientation(&frame);
            let mut src: IWICBitmapSource = frame.cast()?;
            let (mut ow, mut oh) = (0, 0);
            src.GetSize(&mut ow, &mut oh)?;

            if let Some(max) = max_edge {
                let (w, h) = (ow, oh);
                let (tw, th) = fit(w, h, max);
                if (tw, th) != (w, h) {
                    let s = f.CreateBitmapScaler()?;
                    s.Initialize(&src, tw, th, WICBitmapInterpolationModeFant)?;
                    src = s.cast()?;
                }
            }
            if o != 1 {
                let r = f.CreateBitmapFlipRotator()?;
                r.Initialize(&src, transform(o))?;
                src = r.cast()?;
            }
            let conv = f.CreateFormatConverter()?;
            conv.Initialize(
                &src,
                &GUID_WICPixelFormat24bppBGR,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            let (mut w, mut h) = (0, 0);
            conv.GetSize(&mut w, &mut h)?;
            let st = stride(w);
            let data_len = st as usize * h as usize;
            let mut out = vec![0u8; 54 + data_len];
            out[..54].copy_from_slice(&bmp_header(w, h, data_len));
            conv.CopyPixels(std::ptr::null(), st, &mut out[54..])?;
            // A quarter turn swaps the sides.
            let (width, height) = if o >= 5 { (oh, ow) } else { (ow, oh) };
            Ok(Decoded { bmp: out, width, height })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_never_upscales() {
        assert_eq!(fit(4032, 3024, 640), (640, 480));
        assert_eq!(fit(3024, 4032, 640), (480, 640));
        assert_eq!(fit(300, 200, 640), (300, 200));
        assert_eq!(fit(300, 200, 0), (300, 200));
    }

    #[test]
    fn header_is_top_down_24bit() {
        let h = bmp_header(3, 2, stride(3) as usize * 2);
        assert_eq!(&h[0..2], b"BM");
        assert_eq!(stride(3), 12);
        assert_eq!(i32::from_le_bytes(h[22..26].try_into().unwrap()), -2);
        assert_eq!(u16::from_le_bytes(h[28..30].try_into().unwrap()), 24);
        assert_eq!(u32::from_le_bytes(h[2..6].try_into().unwrap()), 54 + 24);
    }

    /// Point `TROVE_HEIC_SAMPLE` at a real HEIC to time the system decoder:
    /// `cargo test heic::tests::sample -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn sample() {
        let Ok(p) = std::env::var("TROVE_HEIC_SAMPLE") else { return };
        for max in [None, Some(640), None, None, Some(640)] {
            let t = std::time::Instant::now();
            let d = decode_bmp(Path::new(&p), max).expect("decode");
            let bmp = d.bmp;
            println!("original {}x{}", d.width, d.height);
            let w = i32::from_le_bytes(bmp[18..22].try_into().unwrap());
            let h = -i32::from_le_bytes(bmp[22..26].try_into().unwrap());
            println!("max={max:?} {w}x{h} {} bytes in {:?}", bmp.len(), t.elapsed());
            if let Ok(out) = std::env::var("TROVE_HEIC_OUT") {
                std::fs::write(format!("{out}-{}.bmp", max.unwrap_or(0)), &bmp).unwrap();
            }
        }
    }
}
