use tauri::{AppHandle, command, Runtime};

use crate::models::*;
use crate::Result;
use crate::BlinkoExt;

#[command]
pub(crate) async fn setcolor<R: Runtime>(
    app: AppHandle<R>,
    payload: SetColorRequest,
) -> Result<()> {
    app.blinko().setcolor(payload)
}

#[command]
pub(crate) async fn open_app_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<()> {
    app.blinko().open_app_settings()
}

#[command]
pub(crate) async fn get_safe_area_insets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SafeAreaInsets> {
    app.blinko().get_safe_area_insets()
}