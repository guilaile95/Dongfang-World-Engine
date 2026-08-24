# 临河客栈

id: riverside-inn
public_name: 临河客栈
time: day-1-morning

## Rules
[public] 地窖里的物事只有掌柜清楚，旁人不会随口知道。
[public] 失踪的客人还没结案；有人吃饭或闲逛时，这件事也不会改写成食客日常。

## Locations
### loc-hall
name: 堂屋
visibility: public

### loc-kitchen
name: 厨房
visibility: public

### loc-cellar
name: 地窖
visibility: hidden

## Characters
### char-player
name: 旅人
kind: player
location: loc-hall

### char-keeper
name: 掌柜老周
kind: npc
location: loc-hall
theme: true

### char-cook
name: 厨子阿福
kind: npc
location: loc-kitchen

## Facts
### fact-inn-open
subject: inn
predicate: status
object: open
visibility: public

### fact-guest-missing
subject: guest-li
predicate: status
object: missing
visibility: public

### fact-bag-in-cellar
subject: guest-li-bag
predicate: located_in
object: loc-cellar
visibility: hidden

## Claims
### claim-bag-in-cellar
subject: guest-li-bag
predicate: located_in
object: loc-cellar
known: char-keeper=confirmed

### claim-guest-fled
subject: guest-li
predicate: fled_to
object: town
known: char-cook=rumor

## Theme
character: char-keeper
memory: 还得把李公子的下落问清楚，不能因为堂里有人吃饭就把这事放下。
public: 掌柜在柜台翻着登记簿，像还在等一个没回来的客人。
public_scope: same_location
