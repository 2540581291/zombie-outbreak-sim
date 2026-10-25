import io
p = "js/agents.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("import { SPECIES, SP } from './species.js';",
              "import { SPECIES, SP, UNIT_COLOR, colorClassOf } from './species.js';")
io.open(p, "w", encoding="utf-8").write(s)
print("agents.js 导入已补")
