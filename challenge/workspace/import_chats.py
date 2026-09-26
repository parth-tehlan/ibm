#!/usr/bin/env python3
"""Import two cptr chat export JSON files into the cptr app database."""
import json, os, sqlite3

DB = os.path.expanduser("~/.cptr/app.db")
CHAT_DIR = "/home/jaguar/Documents/IBM2/.cptr/chats"
USER_ID = "cc9fc4d8-4192-4415-9100-87ae59b887d7"
WORKSPACE = "/home/jaguar/Documents/IBM2"

FILES = [
    "e3fa6eab-4028-4675-b0be-872826ed4a01.json",
    "179c3836-eecb-4e5c-9cf2-df7e364ba15f.json",
]

def main():
    con = sqlite3.connect(DB)
    con.execute("PRAGMA busy_timeout = 10000")
    cur = con.cursor()

    try:
        for fn in FILES:
            path = os.path.join(CHAT_DIR, fn)
            data = json.load(open(path))
            chat_id = data["id"]
            title = data["title"]
            summary = data.get("summary")
            created_at = data["created_at"]
            updated_at = data.get("updated_at") or created_at
            h = data["history"]
            current_id = h.get("currentId")
            messages = h["messages"]

            meta = json.dumps({
                "params": {"tool_approval_mode": "auto", "plan_mode": False, "request_params": {}},
                "last_model": "deepseek-v4-flash-0731",
                "workspace": WORKSPACE,
                "tasks": []
            })
            last_read = updated_at

            cur.execute(
                "INSERT OR REPLACE INTO chats "
                "(id, user_id, title, summary, current_message_id, meta, created_at, updated_at, last_read_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (chat_id, USER_ID, title, summary, current_id, meta, created_at, updated_at, last_read)
            )

            ordered = sorted(messages.values(), key=lambda m: m.get("timestamp", 0))

            for m in ordered:
                mid = m["id"]
                parent_id = m.get("parentId")
                role = m.get("role")
                content = m.get("content", "")
                model = m.get("model")
                done = m.get("done")
                if done is not None:
                    done = 1 if done else 0
                output = m.get("output")
                usage = m.get("usage")
                chat_summary = m.get("chat_summary")
                ts = m.get("timestamp", created_at)

                cur.execute(
                    "INSERT OR REPLACE INTO chat_messages "
                    "(id, chat_id, parent_id, role, content, model, done, output, usage, meta, created_at, chat_summary) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (mid, chat_id, parent_id, role, content, model, done,
                     json.dumps(output) if output is not None else None,
                     json.dumps(usage) if usage is not None else None,
                     None, ts, chat_summary)
                )

            print(f"Imported '{title}' ({chat_id}): {len(messages)} messages, current={current_id}")

        con.commit()
        print("COMMIT OK")
    except Exception as e:
        con.rollback()
        print("ROLLBACK:", e)
        raise
    finally:
        con.close()

if __name__ == "__main__":
    main()