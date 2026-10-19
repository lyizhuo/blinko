const COMMANDS: &[&str] = &["setcolor", "get_safe_area_insets"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .ios_path("ios")
    .build();
}
