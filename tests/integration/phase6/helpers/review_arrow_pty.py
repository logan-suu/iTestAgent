import json
import os
import sys
import tempfile

from opentui_review_confirmation_pty import run_scenario

repo = os.path.abspath(sys.argv[1])
renderer = sys.argv[2]
with tempfile.TemporaryDirectory(prefix='itestagent-arrow-pty-') as cwd:
    results = [run_scenario(repo, cwd, scenario, event, renderer=renderer, arrow_keys=True)
               for scenario, event in [('candidate-review', 'candidate_confirm'),
                                       ('device-review', 'device_confirm'),
                                       ('plan-review', 'plan_confirm')]]
print(json.dumps(results))
