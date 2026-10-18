import sys

def modify_file():
    with open('apps/api/src/ai/route.ts', 'r') as f:
        content = f.read()

    # 1. Add imports
    imports = "import { requireOrgId } from '../middlewares/requireOrgId';\nimport { requirePermission } from '../middlewares/requirePermission';\n"
    if "import { rateLimit }" in content:
        content = content.replace("import { rateLimit } from '../middlewares/rateLimit';", imports + "import { rateLimit } from '../middlewares/rateLimit';")
    else:
        print("Could not find import for rateLimit")
        return

    # 2. Update route signature
    old_route = "aiChatRouter.post('/chat', async (c) => {"
    new_route = "aiChatRouter.post('/chat', requireOrgId(), requirePermission('dashboard', 'view'), async (c) => {"
    content = content.replace(old_route, new_route)

    # 3. Update auth check
    old_auth_check = """  const auth = getAuth(c);
  if (!auth) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }"""
    new_auth_check = """  const auth = getAuth(c)!;"""
    content = content.replace(old_auth_check, new_auth_check)

    with open('apps/api/src/ai/route.ts', 'w') as f:
        f.write(content)

    print("Successfully updated apps/api/src/ai/route.ts")

if __name__ == '__main__':
    modify_file()
