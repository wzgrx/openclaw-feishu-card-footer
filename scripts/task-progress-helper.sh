#!/bin/bash
# task-progress-helper.sh
# Agent-side helper for creating/updating background tasks.
# Compatible with feishu-card-footer TaskManager v2 + openclaw-task-watchdog.
#
# Usage:
#   Create:  task-progress-helper.sh create <taskId> <name> <type> [chatId]
#   Update:  task-progress-helper.sh update <taskId> progress=50 [status=running] [name=...]
#   Done:    task-progress-helper.sh done <taskId> success|error [error="msg"]
#   Get:     task-progress-helper.sh get <taskId>
#   List:    task-progress-helper.sh list

TASK_DIR="${TASK_DIR:-/tmp/openclaw-tasks}"
CMD="${1:-help}"

case "$CMD" in
  create)
    TASK_ID="$2"
    NAME="$3"
    TYPE="${4:-generic}"
    CHAT_ID="${5:-}"
    if [ -z "$TASK_ID" ] || [ -z "$NAME" ]; then
      echo "Usage: $0 create <taskId> <name> <type> [chatId]" >&2; exit 1
    fi
    mkdir -p "$TASK_DIR"
    python3 -c "
import json, time
now = int(time.time() * 1000)
data = {
    'taskId': '$TASK_ID',
    'name': '$(echo "$NAME" | sed "s/'/\\\\'/g")',
    'type': '$TYPE',
    'status': 'running',
    'progress': 0,
    'elapsedMs': 0,
    'startTime': now,
    'lastUpdated': now,
    'chatId': '$CHAT_ID',
    'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
}
with open('$TASK_DIR/$TASK_ID.json', 'w') as f:
    json.dump(data, f, indent=2)
print('Created task: $TASK_ID ($NAME)')
" || echo "Failed to create task $TASK_ID"
    ;;

  update)
    TASK_ID="$2"
    if [ -z "$TASK_ID" ] || [ $# -lt 3 ]; then
      echo "Usage: $0 update <taskId> key=value ..." >&2; exit 1
    fi
    if [ ! -f "$TASK_DIR/$TASK_ID.json" ]; then
      echo "Task $TASK_ID not found" >&2; exit 1
    fi
    # Build Python dict of updates from remaining args
    UPDATES=""
    for arg in "${@:3}"; do
      key="${arg%%=*}"
      val="${arg#*=}"
      # Determine value type
      case "$key" in
        progress|elapsedMs|startTime)
          UPDATES="$UPDATES\ndata['$key'] = ${val:-0}"
          ;;
        status|name|type|chatId|error|logFile)
          escaped_val=$(echo "$val" | sed "s/'/\\\\'/g")
          UPDATES="$UPDATES\ndata['$key'] = '$escaped_val'"
          ;;
      esac
    done
    python3 -c "
import json, time
with open('$TASK_DIR/$TASK_ID.json', 'r') as f:
    data = json.load(f)
$(echo -e "$UPDATES")
data['lastUpdated'] = int(time.time() * 1000)
if data.get('startTime'):
    data['elapsedMs'] = int(time.time() * 1000) - data['startTime']
with open('$TASK_DIR/$TASK_ID.json', 'w') as f:
    json.dump(data, f, indent=2)
print('Updated task: $TASK_ID')
" || echo "Failed to update task $TASK_ID"
    ;;

  done)
    TASK_ID="$2"
    STATUS="${3:-success}"
    ERROR_MSG=""
    if [ -z "$TASK_ID" ]; then
      echo "Usage: $0 done <taskId> success|error [error=msg]" >&2; exit 1
    fi
    if [ ! -f "$TASK_DIR/$TASK_ID.json" ]; then
      echo "Task $TASK_ID not found" >&2; exit 1
    fi
    # Extract optional error= from remaining args
    for arg in "${@:4}"; do
      if [[ "$arg" == error=* ]]; then
        ERROR_MSG="${arg#*=}"
      fi
    done
    ERROR_JSON=""
    if [ -n "$ERROR_MSG" ]; then
      ERROR_JSON="data['error'] = '$(echo "$ERROR_MSG" | sed "s/'/\\\\'/g")'"
    fi
    python3 -c "
import json, time
with open('$TASK_DIR/$TASK_ID.json', 'r') as f:
    data = json.load(f)
data['status'] = '$STATUS'
data['progress'] = 100
$ERROR_JSON
data['lastUpdated'] = int(time.time() * 1000)
if data.get('startTime'):
    data['elapsedMs'] = int(time.time() * 1000) - data['startTime']
with open('$TASK_DIR/$TASK_ID.json', 'w') as f:
    json.dump(data, f, indent=2)
print('Task completed: $TASK_ID ($STATUS)')
" || echo "Failed to complete task $TASK_ID"
    ;;

  get)
    TASK_ID="$2"
    if [ -z "$TASK_ID" ]; then echo "Usage: $0 get <taskId>" >&2; exit 1; fi
    if [ ! -f "$TASK_DIR/$TASK_ID.json" ]; then echo "Task $TASK_ID not found" >&2; exit 1; fi
    cat "$TASK_DIR/$TASK_ID.json"
    ;;

  list)
    if [ -d "$TASK_DIR" ]; then
      for f in "$TASK_DIR"/*.json; do
        [ -f "$f" ] || continue
        python3 -c "
import json
with open('$f') as fh:
    d = json.load(fh)
print(f'{d.get(\"status\",\"?\")} {d.get(\"progress\",0):>3}% {d.get(\"name\",\"?\")}  [{d.get(\"taskId\",\"?\")}]')
"
      done
    else
      echo "No task directory"
    fi
    ;;

  help|*)
    echo "Task Progress Helper"
    echo "Usage:"
    echo "  $0 create <taskId> <name> <type>  [chatId]"
    echo "  $0 update <taskId> progress=50   [status=running]"
    echo "  $0 done   <taskId> success|error  [error=msg]"
    echo "  $0 get    <taskId>"
    echo "  $0 list"
    echo ""
    echo "Types: download, compile, git_clone, transcribe, install, search, generic"
    echo "TASK_DIR=$TASK_DIR"
    ;;
esac
