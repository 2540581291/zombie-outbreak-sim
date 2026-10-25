import io
p = "js/main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("rc.setFromCamera(ndc, camera);", "rc.setFromCamera(ndc, activeCamera());")
io.open(p, "w", encoding="utf-8").write(s)
print("done")
