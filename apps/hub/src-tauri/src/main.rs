mod commands;
mod contracts;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_hub_health,
            commands::cancel_hub_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Zread Hub");
}
