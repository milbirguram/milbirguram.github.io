"""Rebuild the non-commercial data snapshot. Python standard library + curl + Node.

Usage: python scripts/build-data.py --cache C:/path/to/cache

Raw downloads remain in the supplied cache, not in the published project.

"""

import argparse,csv,datetime,hashlib,json,subprocess

from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path,required=True);args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)

sources=[]

def load(file,url):

    p=args.cache/file

    if not p.exists(): subprocess.run(['curl.exe','-fLsS','--max-time','60',url,'-o',str(p)],check=True)

    body=p.read_bytes();sources.append({'file':file,'url':url,'cachedFileModifiedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime,datetime.timezone.utc).isoformat(),'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})

    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def number(row,key):

    x=float(row[key]);assert x==x and abs(x)<1e10,(row.get('playerId'),key,x);return x

skaters=[]

for year in [2023,2024,2025]:

    rows=load(f'skaters-{year}.csv',f'https://moneypuck.com/moneypuck/playerData/seasonSummary/{year}/regular/skaters.csv');seen=set()

    for r in rows:

        if r['situation']!='5on5':continue

        pid=int(r['playerId']);assert pid not in seen;seen.add(pid);assert int(r['season'])==year

        skaters.append(dict(id=pid,season=year,name=r['name'],team=r['team'],position=r['position'],seconds=number(r,'icetime'),shots=number(r,'I_F_unblockedShotAttempts'),xg=number(r,'I_F_xGoals'),goals=number(r,'I_F_goals'),onXga=number(r,'OnIce_A_xGoals'),offXga=number(r,'OffIce_A_xGoals'),bench=number(r,'timeOnBench')))

team_rows=load('teams-2025.csv','https://moneypuck.com/moneypuck/playerData/seasonSummary/2025/regular/teams.csv')

names={'ANA':'Anaheim Ducks','BOS':'Boston Bruins','BUF':'Buffalo Sabres','CAR':'Carolina Hurricanes','CBJ':'Columbus Blue Jackets','CGY':'Calgary Flames','CHI':'Chicago Blackhawks','COL':'Colorado Avalanche','DAL':'Dallas Stars','DET':'Detroit Red Wings','EDM':'Edmonton Oilers','FLA':'Florida Panthers','LAK':'Los Angeles Kings','MIN':'Minnesota Wild','MTL':'Montréal Canadiens','NJD':'New Jersey Devils','NSH':'Nashville Predators','NYI':'New York Islanders','NYR':'New York Rangers','OTT':'Ottawa Senators','PHI':'Philadelphia Flyers','PIT':'Pittsburgh Penguins','SEA':'Seattle Kraken','SJS':'San Jose Sharks','STL':'St. Louis Blues','TBL':'Tampa Bay Lightning','TOR':'Toronto Maple Leafs','UTA':'Utah Mammoth','VAN':'Vancouver Canucks','VGK':'Vegas Golden Knights','WPG':'Winnipeg Jets','WSH':'Washington Capitals'}

teams=[dict(team=r['team'],name=names[r['team']],seconds=number(r,'iceTime'),shots=number(r,'unblockedShotAttemptsFor'),xg=number(r,'xGoalsFor'),goals=number(r,'goalsFor'),xga=number(r,'xGoalsAgainst'),games=int(r['games_played'])) for r in team_rows if r['situation']=='5on5']

assert len(teams)==32 and len({t['team'] for t in teams})==32 and all(t['games']==82 for t in teams)

assert len([r for r in skaters if r['season']==2025 and r['seconds']>=18000])==678

payload={'season':2025,'seasonLabel':'2025–26','builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'snapshot':'Completed regular season; team labels are the source snapshot, not live rosters.','skaters':skaters,'teams':teams}

raw=ROOT/'data'/'input.json';raw.parent.mkdir(exist_ok=True);raw.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

(ROOT/'data'/'sources.json').write_text(json.dumps({'builtAt':payload['builtAt'],'sourcePage':'https://moneypuck.com/data.htm','permission':'Free for non-commercial use with clear MoneyPuck.com credit. Other purposes require permission. Not an unrestricted open-data licence.','sources':sources},indent=2)+'\n',encoding='utf-8')

subprocess.run(['node',str(ROOT/'scripts'/'compile-data.js')],check=True)

raw.unlink()
