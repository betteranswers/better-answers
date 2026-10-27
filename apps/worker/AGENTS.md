# apps/worker

- The worker never migrates and never holds a git credential. The api owns every migration, every OKF write and the bundle's credential.
- Every cocoindex target is `managed_by="user"`.
