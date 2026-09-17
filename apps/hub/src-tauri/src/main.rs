mod commands;
mod contracts;
mod projects;
mod reader;
mod tasks;

fn main() {
    tauri::Builder::default()
        .manage(tasks::TaskCoordinator::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_hub_health,
            commands::set_hub_zread_executable,
            commands::start_hub_open_zread_task,
            commands::start_hub_zread_task,
            commands::cancel_hub_task,
            commands::list_hub_projects,
            commands::register_hub_project,
            commands::set_hub_project_favorite,
            commands::relocate_hub_project,
            commands::remove_hub_project,
            commands::open_hub_project_folder,
            commands::open_hub_project_terminal,
            commands::read_hub_open_zread_wiki,
            commands::read_hub_open_zread_source,
            commands::read_hub_open_zread_asset,
            commands::read_hub_zread_wiki,
            commands::read_hub_zread_source,
            commands::read_hub_zread_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Zread Hub");
}
