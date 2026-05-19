import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ProjectPickerUnavailableError extends Error {
  constructor(message = "Folder picker is not available on this platform") {
    super(message);
    this.name = "ProjectPickerUnavailableError";
  }
}

function isCancel(err: unknown): boolean {
  const record = err as { code?: unknown; stderr?: unknown; message?: unknown };
  const text = `${String(record.stderr ?? "")}\n${String(record.message ?? "")}`;
  return text.includes("User canceled") || text.includes("-128") || record.code === 1;
}

function isMissingCommand(err: unknown): boolean {
  return (err as { code?: unknown }).code === "ENOENT";
}

export async function pickProjectDirectory(): Promise<string | null> {
  if (platform() === "darwin") {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Select project folder")',
      ]);
      return stdout.trim() || null;
    } catch (err) {
      if (isCancel(err)) return null;
      throw err;
    }
  }

  if (platform() === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$dialog.Description = "Select project folder"',
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }",
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Sta",
      "-Command",
      script,
    ]);
    return stdout.trim() || null;
  }

  for (const command of [
    {
      bin: "zenity",
      args: ["--file-selection", "--directory", "--title=Select project folder"],
    },
    {
      bin: "kdialog",
      args: ["--getexistingdirectory", process.env.HOME ?? "/"],
    },
  ]) {
    try {
      const { stdout } = await execFileAsync(command.bin, command.args);
      return stdout.trim() || null;
    } catch (err) {
      if (isMissingCommand(err)) continue;
      if (isCancel(err)) return null;
      throw err;
    }
  }

  throw new ProjectPickerUnavailableError();
}
