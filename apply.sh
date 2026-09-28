#!/bin/sh
# Moves T-468..T-473 to done on origin, from the cloud session that built them (28/09/2026).
# Each push leases on the oid origin held when the session read it, so a ticket edited since is refused.
set -eu
git fetch origin claude/ordna-done-handoff
head=$(git rev-parse FETCH_HEAD)
oid=$(git rev-parse "$head:T-468.md")
git push --force-with-lease=refs/ordna/tasks/T-468:858675fd272291d357d8622f972587ec1f14d1b9 origin "$oid:refs/ordna/tasks/T-468"
git update-ref refs/ordna/tasks/T-468 "$oid"
oid=$(git rev-parse "$head:T-469.md")
git push --force-with-lease=refs/ordna/tasks/T-469:816f03b0680d4122ed2fe14362184fca475dba77 origin "$oid:refs/ordna/tasks/T-469"
git update-ref refs/ordna/tasks/T-469 "$oid"
oid=$(git rev-parse "$head:T-470.md")
git push --force-with-lease=refs/ordna/tasks/T-470:4fa4437fc7ff152700c3557dba4f00e40c8f3a34 origin "$oid:refs/ordna/tasks/T-470"
git update-ref refs/ordna/tasks/T-470 "$oid"
oid=$(git rev-parse "$head:T-471.md")
git push --force-with-lease=refs/ordna/tasks/T-471:3680929c312f2ae804524d8f6e8422b18dcf10aa origin "$oid:refs/ordna/tasks/T-471"
git update-ref refs/ordna/tasks/T-471 "$oid"
oid=$(git rev-parse "$head:T-472.md")
git push --force-with-lease=refs/ordna/tasks/T-472:29fca1bb23e0b5286d439734c24855359c79cb6c origin "$oid:refs/ordna/tasks/T-472"
git update-ref refs/ordna/tasks/T-472 "$oid"
oid=$(git rev-parse "$head:T-473.md")
git push --force-with-lease=refs/ordna/tasks/T-473:d5dd45a2c699c48ca1b0ea86a2bbe658f99748bc origin "$oid:refs/ordna/tasks/T-473"
git update-ref refs/ordna/tasks/T-473 "$oid"
ordna list -s todo
