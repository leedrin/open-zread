mod commands;
mod contracts;
mod projects;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_hub_health,
            commands::cancel_hub_task,
            commands::list_hub_projects,
            commands::register_hub_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Zread Hub");
}
