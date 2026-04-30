export function resolveApprovalAnswer(answer: string): "allow" | "deny" {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "" || trimmed === "y" || trimmed === "yes") {
    return "allow";
  }
  return "deny";
}
