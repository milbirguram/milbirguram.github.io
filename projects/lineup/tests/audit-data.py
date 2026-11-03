"""Independent raw CSV → browser snapshot audit. Does not import model.js.
Usage: python tests/audit-data.py C:/path/to/raw-cache
"""
import csv,json,math,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];cache=Path(sys.argv[1]);text=(ROOT/'data.js').read_text(encoding='utf-8');data=json.loads(text[text.index('=')+1:].strip().rstrip(';'))
for year in [2023,2024,2025]:
 with (cache/f'skaters-{year}.csv').open(encoding='utf-8-sig',newline='') as f:rows={int(r['playerId']):r for r in csv.DictReader(f) if r['situation']=='5on5'}
 exported=[r for r in data['skaters'] if r['season']==year];assert len(exported)==len(rows)
 mapping={'seconds':'icetime','shots':'I_F_unblockedShotAttempts','xg':'I_F_xGoals','goals':'I_F_goals','onXga':'OnIce_A_xGoals','offXga':'OffIce_A_xGoals','bench':'timeOnBench'}
 for row in exported:
  source=rows[row['id']];assert row['name']==source['name'] and row['team']==source['team']
  for key,column in mapping.items():assert row[key]==float(source[column]),(row['id'],key)
with (cache/'teams-2025.csv').open(encoding='utf-8-sig',newline='') as f:rows={r['team']:r for r in csv.DictReader(f) if r['situation']=='5on5'}
for row in data['teams']:
 for key,column in {'seconds':'iceTime','shots':'unblockedShotAttemptsFor','xg':'xGoalsFor','goals':'goalsFor','xga':'xGoalsAgainst'}.items():assert row[key]==float(rows[row['team']][column])
assert len(data['teams'])==32
print('Independent CSV audit passed: every exported numeric input equals the original source field; real team totals used')
