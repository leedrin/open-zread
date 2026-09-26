mod commands;
mod contracts;
mod history;
mod markdown;
mod merge;
mod mutations;
mod page_ops;
mod projects;
mod reader;
mod search;
mod tasks;
mod wiki_instances;

fn main() {
    tauri::Builder::default()
        .manage(tasks::TaskCoordinator::default())
        .manage(mutations::ChangeSetCoordinator::default())
        .manage(markdown::MarkdownIndexCache::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_hub_health,
            commands::set_hub_zread_executable,
            commands::start_hub_open_zread_task,
            commands::start_hub_zread_task,
            commands::preview_hub_wiki_change,
            commands::preview_hub_wiki_structure_change,
            commands::apply_hub_wiki_change,
            commands::list_hub_wiki_history,
            commands::restore_hub_wiki_history,
            commands::search_hub_wiki,
            commands::search_hub_project_markdown,
            commands::ask_hub_project_markdown,
            commands::create_hub_wiki_page,
            commands::create_hub_wiki_pages,
            commands::delete_hub_wiki_page,
            commands::update_hub_wiki_page_metadata,
            commands::merge_hub_wiki_text,
            commands::ask_hub_wiki,
            commands::rewrite_hub_wiki_page,
            commands::draft_hub_wiki_page,
            commands::cancel_hub_task,
            commands::list_hub_projects,
            commands::register_hub_project,
            commands::set_hub_project_favorite,
            commands::rename_hub_project,
            commands::list_hub_project_wikis,
            commands::locate_hub_project_wikis,
            commands::list_hub_project_markdown,
            commands::read_hub_project_markdown,
            commands::save_hub_project_markdown,
            commands::read_hub_project_markdown_asset,
            commands::read_hub_project_markdown_source,
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
