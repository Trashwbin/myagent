export type PermissionDecision =
  | { behavior: "allow"; reason?: string }
  | { behavior: "ask"; reason: string }
  | { behavior: "deny"; reason: string }
  | { behavior: "invalid"; reason: string };
