import sys, os
sys.path.insert(0, "tools")
from cities import CITIES
for k, v in CITIES.items():
    print("  %-10s %-16s z%d  %s" % (k, v["name"], v["zoom"], v["pbf"]))
