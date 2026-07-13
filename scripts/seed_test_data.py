#!/usr/bin/env python3
# Siembra datos dummy (INGLÉS) en la cuenta de PRUEBA de nutri para capturas. No datos reales.
import os, json, random, datetime, urllib.request, urllib.error

URL   = os.environ["VITE_SUPABASE_URL"].rstrip("/")
ANON  = os.environ["VITE_SUPABASE_ANON_KEY"]
EMAIL = os.environ["VITE_DEV_EMAIL"]
PWD   = os.environ["VITE_DEV_PASSWORD"]
random.seed(7)

def req(method, path, body=None, headers=None):
    h = {"apikey": ANON, "Content-Type": "application/json"}
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, path, e.read().decode()[:300]); raise

tok = req("POST", "/auth/v1/token?grant_type=password", {"email": EMAIL, "password": PWD})
JWT = tok["access_token"]
AUTH = {"Authorization": "Bearer " + JWT}
WH = dict(AUTH, **{"Content-Profile": "nutri", "Prefer": "return=representation"})
DH = dict(AUTH, **{"Content-Profile": "nutri"})
print("login OK")

# --- WIPE (orden por FK: entries -> foods/labels/targets) ---
ALL = "?created_at=lt.2100-01-01"
req("DELETE", "/rest/v1/entries" + ALL, None, DH)
req("DELETE", "/rest/v1/foods" + ALL, None, DH)
req("DELETE", "/rest/v1/meal_labels?name=neq.__none__", None, DH)
req("DELETE", "/rest/v1/targets?valid_from=lt.2100-01-01", None, DH)
print("wipe OK")

FOODS = [
    ("Oatmeal",389,16.9,66.3,6.9,{"fibra_g":10.6,"magnesio_mg":177,"hierro_mg":4.7},"manual"),
    ("Grilled chicken breast",165,31,0,3.6,{"sodio_mg":74,"potasio_mg":256},"manual"),
    ("White rice, cooked",130,2.7,28,0.3,{"sodio_mg":1},"manual"),
    ("Whole egg",155,13,1.1,11,{"sodio_mg":124,"colesterol_mg":373},"manual"),
    ("Banana",89,1.1,22.8,0.3,{"potasio_mg":358,"fibra_g":2.6,"azucar_g":12.2},"manual"),
    ("Avocado",160,2,8.5,14.7,{"fibra_g":6.7,"potasio_mg":485},"manual"),
    ("Black beans, cooked",132,8.9,23.7,0.5,{"fibra_g":8.7,"hierro_mg":2.1,"potasio_mg":355},"manual"),
    ("Corn tortilla",218,5.7,44.6,2.9,{"fibra_g":6.3,"sodio_mg":45,"potasio_mg":186,"calcio_mg":81},"off"),
    ("Plain yogurt",61,3.5,4.7,3.3,{"calcio_mg":121},"manual"),
    ("Apple",52,0.3,13.8,0.2,{"fibra_g":2.4,"azucar_g":10.4},"manual"),
    ("Salmon",208,20,0,13,{"sodio_mg":59,"potasio_mg":363},"manual"),
    ("Broccoli, cooked",35,2.4,7.2,0.4,{"fibra_g":3.3,"calcio_mg":40,"potasio_mg":293},"manual"),
    ("Almonds",579,21,21.6,49.9,{"fibra_g":12.5,"magnesio_mg":270,"calcio_mg":269},"manual"),
    ("Whole-grain bread",247,13,41,3.4,{"fibra_g":7,"sodio_mg":450},"off"),
    ("Canned tuna in water",116,26,0,1,{"sodio_mg":247,"potasio_mg":237},"manual"),
    ("Whole milk",61,3.2,4.8,3.3,{"calcio_mg":113},"off"),
]
payload = [{"name":n,"kcal":k,"protein_g":p,"carbs_g":c,"fat_g":f,"micros":m,"source":s}
           for (n,k,p,c,f,m,s) in FOODS]
req("POST","/rest/v1/foods", payload, WH)
agua = req("POST","/rest/v1/foods", [{"name":"Water","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"micros":{"agua_ml":100},"source":"manual"}], WH)
agua_id = agua[0]["id"]
print("foods:", len(FOODS)+1)

req("POST","/rest/v1/prefs", {"data":{"water_food_id":agua_id,"water_glass_ml":1000,"today_view":"estado","lang":"en","units":"metric"}},
    dict(WH, **{"Prefer":"resolution=merge-duplicates,return=representation"}))
print("prefs set")

vf = (datetime.date.today() - datetime.timedelta(days=35)).isoformat()
def target(dow, we):
    return {"dow":dow,"valid_from":vf,"label":"Recomposition","goal":"recomposicion",
            "kcal":2600 if we else 2400,"protein_g":165,"carbs_g":270 if we else 250,"fat_g":75 if we else 70,
            "micros":{"agua_ml":3000,"sodio_mg":2300,"potasio_mg":3500,"fibra_g":30}}
req("POST","/rest/v1/targets",[target(d, d in (0,6)) for d in range(7)], WH)
print("targets phase OK (vf", vf, ")")

BK = [("Oatmeal",60),("Whole egg",100),("Banana",120),("Whole-grain bread",80),("Plain yogurt",150),("Whole milk",200)]
LU = [("Grilled chicken breast",180),("White rice, cooked",200),("Black beans, cooked",150),("Corn tortilla",90),("Avocado",50),("Broccoli, cooked",120)]
DI = [("Salmon",160),("Canned tuna in water",120),("White rice, cooked",150),("Broccoli, cooked",100),("Whole egg",100)]
SN = [("Apple",150),("Almonds",30),("Plain yogurt",120),("Banana",110)]
def jitter(g): return round(g*random.uniform(0.85,1.15))
def log(item,g,label,day):
    req("POST","/rest/v1/rpc/log_entry",{"p_item":item,"p_grams":g,"p_label":label,"p_day":day}, DH)

today = datetime.date.today(); calls = 0
for i in range(21):
    day = (today - datetime.timedelta(days=i)).isoformat()
    partial = (i == 0)
    for (item,g) in random.sample(BK, 2): log(item, jitter(g), "Breakfast", day); calls += 1
    if not partial:
        for (item,g) in random.sample(LU, random.choice([2,3])): log(item, jitter(g), "Lunch", day); calls += 1
        for (item,g) in random.sample(DI, 2): log(item, jitter(g), "Dinner", day); calls += 1
        if random.random() < 0.7:
            item,g = random.choice(SN); log(item, jitter(g), "Snack", day); calls += 1
    else:
        item,g = random.choice(LU); log(item, jitter(g), "Lunch", day); calls += 1
    for _ in range(random.choice([2,3]) if not partial else 1):
        log("Water", random.choice([500,600,700,800]), None, day); calls += 1

print("entries:", calls, "DONE")
