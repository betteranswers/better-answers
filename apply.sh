#!/bin/sh
# Writes eight tickets done state to origin, each with a lease on the copy this session read.
set -eu
git fetch origin claude/ordna-done-handoff
oid=$(git rev-parse FETCH_HEAD:T-436.md)
git push --force-with-lease=refs/ordna/tasks/T-436:fe6a9a50cb7320e3a7875b8b99b2b148acdb822c origin "$oid:refs/ordna/tasks/T-436"
git update-ref refs/ordna/tasks/T-436 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-438.md)
git push --force-with-lease=refs/ordna/tasks/T-438:6417cfac52bfbd9ce0ed706adcb68a9603ecca3b origin "$oid:refs/ordna/tasks/T-438"
git update-ref refs/ordna/tasks/T-438 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-455.md)
git push --force-with-lease=refs/ordna/tasks/T-455:05070c5d6d3c505a888f39d3faa4f40e1537445b origin "$oid:refs/ordna/tasks/T-455"
git update-ref refs/ordna/tasks/T-455 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-462.md)
git push --force-with-lease=refs/ordna/tasks/T-462:c50a8cf9c59b96a964e5ddc626814a004f639111 origin "$oid:refs/ordna/tasks/T-462"
git update-ref refs/ordna/tasks/T-462 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-463.md)
git push --force-with-lease=refs/ordna/tasks/T-463:a2a8f370e2fddbb6604e2047bc91bd69374e7563 origin "$oid:refs/ordna/tasks/T-463"
git update-ref refs/ordna/tasks/T-463 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-465.md)
git push --force-with-lease=refs/ordna/tasks/T-465:147b97041bf092cd52c246af7615a122a8225ed5 origin "$oid:refs/ordna/tasks/T-465"
git update-ref refs/ordna/tasks/T-465 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-461.md)
git push --force-with-lease=refs/ordna/tasks/T-461:2434d5469108e72c2d0032ebd50e1ba025980574 origin "$oid:refs/ordna/tasks/T-461"
git update-ref refs/ordna/tasks/T-461 "$oid"
oid=$(git rev-parse FETCH_HEAD:T-467.md)
git push --force-with-lease=refs/ordna/tasks/T-467:b3234f161ba90c37a3c24aa74ac49a4e5b3d1890 origin "$oid:refs/ordna/tasks/T-467"
git update-ref refs/ordna/tasks/T-467 "$oid"
ordna list -s todo
