import re

with open("apps/admin/src/__tests__/tenancyGate.test.ts", "r") as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if "dashboard.ts:171" in line:
        continue
    new_lines.append(line)

with open("apps/admin/src/__tests__/tenancyGate.test.ts", "w") as f:
    f.writelines(new_lines)
