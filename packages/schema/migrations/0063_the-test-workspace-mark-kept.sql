-- Custom migration (hand-written SQL; ADR 0032).
-- A removed mark would reopen the workspace's invitations to any address; the fixture only writes and corrects one.
REVOKE DELETE ON "test_workspace_mark" FROM app_rt;
