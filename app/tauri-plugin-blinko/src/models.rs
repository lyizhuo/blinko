use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetColorRequest {
  pub hex: String,
}

/// System bar / display cutout insets in density independent pixels.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeAreaInsets {
  pub top: f32,
  pub right: f32,
  pub bottom: f32,
  pub left: f32,
}