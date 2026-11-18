//! Paths of files copied in Explorer (`CF_HDROP`).
//!
//! The WebView's paste event carries `File` objects without paths, and Trove
//! only stores where a file is, so the list has to come from the system.

#[cfg(windows)]
pub fn files() -> Vec<String> {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP as u32) == 0 {
            return Vec::new();
        }
        // Another process can hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            return Vec::new();
        }
        let mut out = Vec::new();
        let drop = GetClipboardData(CF_HDROP as u32);
        if !drop.is_null() {
            let count = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
            for i in 0..count {
                let len = DragQueryFileW(drop, i, std::ptr::null_mut(), 0);
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; len as usize + 1];
                let got = DragQueryFileW(drop, i, buf.as_mut_ptr(), buf.len() as u32);
                out.push(String::from_utf16_lossy(&buf[..got as usize]));
            }
        }
        CloseClipboard();
        out
    }
}

#[cfg(not(windows))]
pub fn files() -> Vec<String> {
    Vec::new()
}
