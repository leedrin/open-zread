/**
 * Typed wire contracts shared by the React Hub client and the Tauri commands.
 *
 * Keep these values JSON-serializable. The Rust side mirrors the structures in
 * apps/hub/src-tauri/src/contracts.rs because Rust cannot import TypeScript.
 */

export const HUB_COMMANDS = {
  getHealth: 'get_hub_health',
  cancelTask: 'cancel_hub_task',
} as const;

export const HUB_EVENTS = {
  task: 'hub://task-event',
} as const;

export type HubCommandName = typeof HUB_COMMANDS[keyof typeof HUB_COMMANDS];

export type HubRuntime = 'tauri';
export type HubServiceStatus = 'healthy' | 'degraded' | 'unavailable';

export interface HubServiceHealth {
  name: 'Hub Application Service';
  status: HubServiceStatus;
}

export interface HubHealth {
  appVersion: string;
  runtime: HubRuntime;
  os: string;
  service: HubServiceHealth;
}

export type HubTaskKind = 'generation' | 'update' | 'maintenance';
export type HubTaskStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface HubTaskProgress {
  current: number;
  total: number;
}

export interface HubTaskEvent {
  taskId: string;
  kind: HubTaskKind;
  status: HubTaskStatus;
  phase: string;
  occurredAt: string;
  message?: string;
  progress?: HubTaskProgress;
}

export const HUB_TASK_KINDS = ['generation', 'update', 'maintenance'] as const;
export const HUB_TASK_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export interface CancelTaskResponse {
  taskId: string;
  accepted: boolean;
  status: Extract<HubTaskStatus, 'cancelling' | 'cancelled'>;
}

export type HubCommandErrorCode =
  | 'invalid_request'
  | 'task_not_found'
  | 'service_unavailable'
  | 'internal_error';

export interface HubCommandError {
  code: HubCommandErrorCode;
  message: string;
  retryable: boolean;
}
