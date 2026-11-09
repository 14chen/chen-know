import sqlite3, sys, os
p = sys.argv[1]
print("FILE:", p, os.path.getsize(p), "B")
try:
    c = sqlite3.connect(p)
    ic = c.execute("PRAGMA integrity_check").fetchone()[0]
    print("  integrity:", ic)
    for t in ("users","spaces","notes","folders","tags","attachments","note_versions","links"):
        try:
            n = c.execute("select count(*) from %s" % t).fetchone()[0]
            print("  %-15s %s" % (t, n))
        except Exception as e:
            print("  %-15s ERR %s" % (t, e))
    print("  users:", [r[0] for r in c.execute("select username from users")])
    print("  notes:")
    for r in c.execute("select id, title, length(content), updated_at from notes where deleted_at is null order by updated_at desc"):
        print("    id=%-4s %-28s %6s chars  %s" % (r[0], r[1][:28], r[2], r[3]))
    c.close()
except Exception as e:
    print("  OPEN FAILED:", e)
