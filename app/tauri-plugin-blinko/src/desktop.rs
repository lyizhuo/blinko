use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<Blinko<R>> {
  Ok(Blinko(app.clone()))
}

/// Access to the blinko APIs.
pub struct Blinko<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Blinko<R> {
  pub fn setcolor(&self, payload: SetColorRequest) -> crate::Result<()> {
    Ok(())
  }

  pub fn open_app_settings(&self) -> crate::Result<()> {
    // On desktop, this is a no-op or could open system settings
    // Different platforms would need different implementations
    Ok(())
  }

  pub fn get_safe_area_insets(&self) -> crate::Result<SafeAreaInsets> {
    // Desktop windows are not drawn edge-to-edge.
    Ok(SafeAreaInsets {
      top: 0.0,
      right: 0.0,
      bottom: 0.0,
      left: 0.0,
    })
  }
}
