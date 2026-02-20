/**
 * Asana Integration
 *
 * Provides access to Asana project management -- list projects, list tasks,
 * create tasks, and update tasks via the Asana REST API.
 *
 * @requires ASANA_ACCESS_TOKEN - Personal access token from https://app.asana.com/0/developer-console
 * @see https://developers.asana.com/reference/rest-api-reference
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://app.asana.com/api/1.0";

export default class AsanaIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "asana",
    name: "Asana",
    category: "productivity",
    version: "1.0.0",
    description: "List projects, list tasks, create tasks, and update tasks in Asana.",
    auth: {
      type: "token",
      envVars: ["ASANA_ACCESS_TOKEN"],
    },
    tools: [
      {
        name: "asana_list_projects",
        description: "List projects in a workspace.",
        parameters: {
          type: "object",
          properties: {
            workspaceId: { type: "string", description: "Workspace GID. If omitted, uses the first available workspace." },
          },
        },
      },
      {
        name: "asana_list_tasks",
        description: "List tasks in a project.",
        parameters: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project GID." },
            completed: { type: "boolean", description: "Filter by completion status (optional)." },
          },
          required: ["projectId"],
        },
      },
      {
        name: "asana_create_task",
        description: "Create a new task in a project.",
        parameters: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project GID to add the task to." },
            name: { type: "string", description: "Task name." },
            notes: { type: "string", description: "Task notes/description." },
            assignee: { type: "string", description: "Assignee email or GID (optional)." },
            dueOn: { type: "string", description: "Due date in YYYY-MM-DD format (optional)." },
          },
          required: ["projectId", "name"],
        },
      },
      {
        name: "asana_update_task",
        description: "Update an existing task's fields.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task GID." },
            name: { type: "string", description: "New task name (optional)." },
            notes: { type: "string", description: "New notes (optional)." },
            completed: { type: "boolean", description: "Mark as complete/incomplete (optional)." },
            assignee: { type: "string", description: "Reassign to email or GID (optional)." },
            dueOn: { type: "string", description: "New due date in YYYY-MM-DD format (optional)." },
          },
          required: ["taskId"],
        },
      },
    ],
  };

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const creds = await this.getCredentials<{ ASANA_ACCESS_TOKEN: string }>();
    if (!creds?.ASANA_ACCESS_TOKEN) throw new Error("Missing ASANA_ACCESS_TOKEN");

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${creds.ASANA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) throw new Error(`Asana ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "asana_list_projects":
          return await this.listProjects(args.workspaceId as string | undefined);
        case "asana_list_tasks":
          return await this.listTasks(args.projectId as string, args.completed as boolean | undefined);
        case "asana_create_task":
          return await this.createTask(args);
        case "asana_update_task":
          return await this.updateTask(args);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Asana error: ${(err as Error).message}`);
    }
  }

  private async listProjects(workspaceId?: string): Promise<ToolResult> {
    // If no workspace provided, resolve the first one
    if (!workspaceId) {
      const wsData = await this.request("/workspaces?limit=1");
      const ws = wsData.data?.[0];
      if (!ws) return this.error("No workspaces found. Provide a workspaceId.");
      workspaceId = ws.gid;
    }

    const data = await this.request(`/workspaces/${workspaceId}/projects?opt_fields=gid,name,archived&limit=100`);
    const projects = (data.data ?? []).filter((p: any) => !p.archived);
    const summary = projects
      .map((p: any) => `${p.name} (${p.gid})`)
      .join("\n");
    return this.ok(summary || "No projects found.", { count: projects.length, workspaceId });
  }

  private async listTasks(projectId: string, completed?: boolean): Promise<ToolResult> {
    let path = `/projects/${projectId}/tasks?opt_fields=gid,name,completed,assignee.name,due_on&limit=100`;
    if (completed !== undefined) {
      path += `&completed_since=${completed ? "now" : "2000-01-01T00:00:00Z"}`;
    }

    const data = await this.request(path);
    let tasks = data.data ?? [];

    // Client-side filter if completed flag was provided
    if (completed !== undefined) {
      tasks = tasks.filter((t: any) => t.completed === completed);
    }

    const summary = tasks
      .map((t: any) => {
        const status = t.completed ? "[done]" : "[open]";
        const assignee = t.assignee?.name ? ` (${t.assignee.name})` : "";
        const due = t.due_on ? ` due:${t.due_on}` : "";
        return `${status} ${t.name}${assignee}${due} (${t.gid})`;
      })
      .join("\n");
    return this.ok(summary || "No tasks found.", { count: tasks.length });
  }

  private async createTask(args: Record<string, unknown>): Promise<ToolResult> {
    const body: Record<string, unknown> = {
      name: args.name as string,
      projects: [args.projectId as string],
    };
    if (args.notes) body.notes = args.notes;
    if (args.assignee) body.assignee = args.assignee;
    if (args.dueOn) body.due_on = args.dueOn;

    const data = await this.request("/tasks", {
      method: "POST",
      body: JSON.stringify({ data: body }),
    });
    const task = data.data;
    return this.ok(`Task created: ${task.name} (${task.gid})`, { gid: task.gid });
  }

  private async updateTask(args: Record<string, unknown>): Promise<ToolResult> {
    const taskId = args.taskId as string;
    const body: Record<string, unknown> = {};
    if (args.name !== undefined) body.name = args.name;
    if (args.notes !== undefined) body.notes = args.notes;
    if (args.completed !== undefined) body.completed = args.completed;
    if (args.assignee !== undefined) body.assignee = args.assignee;
    if (args.dueOn !== undefined) body.due_on = args.dueOn;

    if (Object.keys(body).length === 0) {
      return this.error("No fields to update. Provide at least one of: name, notes, completed, assignee, dueOn.");
    }

    const data = await this.request(`/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ data: body }),
    });
    const task = data.data;
    const status = task.completed ? "completed" : "open";
    return this.ok(`Task "${task.name}" updated (${status}).`, { gid: task.gid });
  }
}
