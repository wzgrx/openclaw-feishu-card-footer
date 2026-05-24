#!/bin/bash
# run-task.sh — 后台任务启动器，配合 feishu-card-footer 进度监控
# 用法: scripts/run-task.sh --type download --name "下载模型" --cmd "wget ..."
#                        [--log /tmp/mytask.log] [--pid-file /tmp/mytask.pid]

set -euo pipefail

TASK_DIR="${TASK_DIR:-/tmp/openclaw-tasks}"
mkdir -p "$TASK_DIR"

TASK_ID=""
TYPE=""
NAME=""
CMD=""
LOG=""
PID_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --task-id) TASK_ID="$2"; shift 2 ;;
        --type) TYPE="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        --cmd) CMD="$2"; shift 2 ;;
        --log) LOG="$2"; shift 2 ;;
        --pid-file) PID_FILE="$2"; shift 2 ;;
        --help)
            echo "Usage: run-task.sh --type <type> --name <name> --cmd <command> [options]"
            exit 0 ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

[ -z "$TYPE" ] && { echo "Need --type"; exit 1; }
[ -z "$NAME" ] && { echo "Need --name"; exit 1; }
[ -z "$CMD" ] && { echo "Need --cmd"; exit 1; }

TASK_ID="${TASK_ID:-$(uuidgen 2>/dev/null || date +%s)-$$}"
LOG="${LOG:-/tmp/openclaw-task-${TASK_ID}.log}"
PID_FILE="${PID_FILE:-/tmp/openclaw-task-${TASK_ID}.pid}"

# 写入初始进度文件
cat > "$TASK_DIR/$TASK_ID.json" <<JSONEOF
{
  "taskId": "$TASK_ID",
  "name": "$NAME",
  "type": "$TYPE",
  "status": "running",
  "progress": 0,
  "elapsedMs": 0,
  "startTime": $(date +%s%3N),
  "logFile": "$LOG"
}
JSONEOF

echo "🚀 [$TASK_ID] $NAME"

# 启动后台命令
if [ "$TYPE" = "download" ]; then
    # 下载类型：通过解析 wget/curl 输出来更新进度
    (
        eval "$CMD" > "$LOG" 2>&1 &
        CHILD_PID=$!
        echo $CHILD_PID > "$PID_FILE"

        # 循环读取日志中的进度百分比
        while kill -0 $CHILD_PID 2>/dev/null; do
            sleep 3
            PERCENT=$(grep -oP '\d+(?=%)' "$LOG" 2>/dev/null | tail -1)
            [ -n "$PERCENT" ] && cat > "$TASK_DIR/$TASK_ID.json" <<UPD
$(jq ".progress=$PERCENT.elapsedMs=$(($(date +%s%3N)-$(jq -r '.startTime' "$TASK_DIR/$TASK_ID.json" 2>/dev/null||echo 0)))" "$TASK_DIR/$TASK_ID.json" 2>/dev/null || cat "$TASK_DIR/$TASK_ID.json")
UPD
        done

        wait $CHILD_PID
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 0 ]; then
            cat > "$TASK_DIR/$TASK_ID.json" <<UPD
$(jq ".status=\"success\".progress=100.elapsedMs=$(($(date +%s%3N)-$(jq -r '.startTime' "$TASK_DIR/$TASK_ID.json")))" "$TASK_DIR/$TASK_ID.json" 2>/dev/null)
UPD
        else
            cat > "$TASK_DIR/$TASK_ID.json" <<UPD
$(jq ".status=\"error\".error=\"exit $EXIT_CODE\"" "$TASK_DIR/$TASK_ID.json" 2>/dev/null)
UPD
        fi
    ) &
else
    # 其他类型：直接启动，定期更新"还在运行"
    (
        eval "$CMD" > "$LOG" 2>&1 &
        CHILD_PID=$!
        echo $CHILD_PID > "$PID_FILE"

        while kill -0 $CHILD_PID 2>/dev/null; do
            sleep 5
            ELAPSED=$(($(date +%s%3N)-$(jq -r '.startTime' "$TASK_DIR/$TASK_ID.json" 2>/dev/null||echo 0)))
            # 推算进度：从日志行数/总行数估计（仅适用于编译等可预估场景）
            LINES=$(wc -l < "$LOG" 2>/dev/null || echo 0)
            cat > "$TASK_DIR/$TASK_ID.json" <<UPD
$(jq ".elapsedMs=$ELAPSED.progress=(if .totalLines then ([((($LINES|tonumber)/.totalLines*100)|floor),99]|min) else (.progress//0) end)" "$TASK_DIR/$TASK_ID.json" 2>/dev/null)
UPD
        done

        wait $CHILD_PID
        EXIT_CODE=$?
        cat > "$TASK_DIR/$TASK_ID.json" <<UPD
$(jq ".status=\"success\".progress=100.elapsedMs=$(($(date +%s%3N)-$(jq -r '.startTime' "$TASK_DIR/$TASK_ID.json")))" "$TASK_DIR/$TASK_ID.json" 2>/dev/null)
UPD
    ) &
fi

echo "  PID: $(cat "$PID_FILE" 2>/dev/null || echo '?')"
echo "  日志: $LOG"
echo "  进度: $TASK_DIR/$TASK_ID.json"
