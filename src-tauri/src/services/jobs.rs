//! Single-flight guard + cancellation flag for long-running import jobs.
//!
//! Imports used to run inline on the WebView callback thread, which froze the
//! whole window for as long as a folder scan took. Moving them onto a blocking
//! thread introduces two new problems: the user needs a way to stop one, and
//! two concurrent jobs would interleave their progress events into nonsense.
//! One global pair of flags solves both — by design there is never more than
//! one import in flight.

use std::sync::atomic::{AtomicBool, Ordering};

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

/// RAII holder of the single import slot. Clears both flags on drop, so an
/// early `?` return inside a job can't leave the slot wedged.
pub struct ImportJob;

impl ImportJob {
    /// Claim the slot. `None` means another import is already running.
    pub fn begin() -> Option<Self> {
        if RUNNING.swap(true, Ordering::SeqCst) {
            return None;
        }
        CANCEL.store(false, Ordering::SeqCst);
        Some(ImportJob)
    }

    /// Checked between files — cancellation is cooperative, never mid-file.
    pub fn cancelled(&self) -> bool {
        CANCEL.load(Ordering::SeqCst)
    }
}

impl Drop for ImportJob {
    fn drop(&mut self) {
        CANCEL.store(false, Ordering::SeqCst);
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Ask the in-flight import to stop at the next file boundary. No-op when
/// nothing is running.
pub fn request_cancel() {
    if RUNNING.load(Ordering::SeqCst) {
        CANCEL.store(true, Ordering::SeqCst);
    }
}
