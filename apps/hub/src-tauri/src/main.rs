mod commands;
mod contracts;
mod projects;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_hub_health,
            commands::cancel_hub_task,
            commands::list_hub_projects,
            commands::register_hub_project,
            commands::set_hub_project_favorite,
            commands::relocate_hub_project,
            commands::remove_hub_project,
            commands::open_hub_project_folder,
            commands::open_hub_project_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Zread Hub");
}
