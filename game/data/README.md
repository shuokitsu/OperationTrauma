# データの書き方（正式版 `game/data/`）

ゲームは起動時にこのフォルダの JSON を読み込みます。**ファイルを書き換えて、ブラウザを再読み込みすれば反映されます**（プログラムの修正は要りません）。

- 書き方を間違えたとき（かっこの閉じ忘れ、存在しない病巣の名前など）は、起動時に画面の上に赤い帯で、ファイル名と誤りの内容が出ます。
- どのファイルでも、`"_note"` のように `_` で始まる項目はメモとして書けます（ゲームは読みません）。行の先頭が `//` の行も読み飛ばします。
- 座標は手術エリアのマス座標 `[x, y]`（横 0〜99、縦 0〜49。左上が `[0, 0]`）。
- ここに無いことをしたいとき（新しい機器、新しい操作の仕組みなど）は、プログラムの修正が要ります。

| ファイル | 内容 |
|---|---|
| `system.json` | 難易度の係数、配点の既定値、評価・ランクのしきい値、キャラクター（立ち絵）、暗転や字幕の時間、読み込む音の一覧 |
| `instruments.json` | 医療機器の性能（ストック、ダメージ、判定の幅、薬の種類と効果・限度量） |
| `lesions.json` | 病巣の種類（形、治療手順、回復値、ダメージ、バイタル減少、配点） |
| `stages/index.json` | ステージの一覧と、ステージセレクト画面での位置・線 |
| `stages/stageN.json` | ステージ1つ分（会話、ブリーフィング、ステップ、病巣の配置、字幕、クリア後の処理） |
| `training.json` | トレーニング用ステージ（ステージと同じ形） |

## 1. ステージ（`stages/stageN.json`）

| 項目 | 内容 |
|---|---|
| `name`、`title` | ステージセレクトに出す名前と副題 |
| `unlock` | 開放条件。`{ "cleared": ["stage1"] }`（クリア済みのステージ）、`{ "flags": ["フラグ名"] }`。`{}` は最初から開放 |
| `goals` | `clear`：ブリーフィングに出すクリア目標の文。`effort`：努力目標の配列 `{ "text", "condition", "bonus_points" }`。`condition` は `{ "type": "miss_count_max", "value": 3 }`（ミスが3回以内）、`vital_min`（バイタルが一度も value 未満にならない）、`time_left_min`（残り時間が value 秒以上） |
| `patients` | 患者の一覧。`images`（手術エリアの背景。3枚あれば呼吸のアニメーション）、`fallback_images`（読めなかったときの代わり）、`dose_limits`（薬ごとの限度量。`{ "anesthesia": 250 }`） |
| `start_vital` | 開始時のバイタル |
| `natural_decay` | 自然減少 `{ "interval_sec": 4, "amount": 1 }`。`null` なら減らない |
| `time_limit_sec` | 制限時間（秒）。書かなければ時間制限なし |
| `time_limit_fixed` | `true` にすると、制限時間に難易度の係数を掛けない |
| `on_timeout` | 時間切れの扱い。書かなければゲームオーバー。`{ "type": "end_stage", "set_flags": […], "clear_flags": […] }` で、ゲームオーバーにせずステージを終える |
| `no_rank` | `true` にすると、ランクを付けない（リザルトは CLEAR だけ） |
| `coefficients` | ステージ係数。`{ "anesthesia_duration": 0.5 }` のように書く。項目名は `system.json` の難易度の `coef` と同じ |
| `drugs` | このステージで薬ボタンに足す薬（病巣が使う薬は自動で足される） |
| `talk_before` | ゲーム前の会話（会話画面） |
| `briefing` | ブリーフィング（会話画面のまま、暗転して目標を出す） |
| `steps` | ステップの配列（下の 1.1） |
| `talk_after` | リザルトのあとの会話（会話画面） |
| `gameover_talks` | 原因ごとのゲームオーバーの会話 `{ "vital": […], "dose": […], "timeout": […] }`。書かなければ `system.json` の既定の会話 |
| `on_clear` | クリア後の処理。`{ "set_flags": […], "clear_flags": […], "unlock_stages": […] }`。配列にして `"if"` を付けると、結果ごとに分けられる |
| `ending` | クリアでエンディングにする `{ "title": "GOOD END", "text": "…" }` |

### 1.1 ステップ（`steps` の1つ）

| 項目 | 内容 |
|---|---|
| `id` | ステップの名前（ステージの中で重ならないように） |
| `if`、`if_not` | このフラグがあるとき（無いとき）だけ、このステップを行う（処置内容の分岐） |
| `patient` | このステップの患者（`patients` の名前）。書かなければ前のステップのまま |
| `talk_before` | ステップの前の、治療を止める会話（ゲーム画面に重ねる） |
| `lesions` | 病巣の配置の配列（下の 1.2） |
| `subtitles` | 字幕の配列（下の 1.3） |
| `clear` | ステップのクリア条件。書かなければ「出した病巣がすべて治る」。`{ "type": "inject", "drug": "recovery", "amount": 80 }`（薬を一定量打つ）、`{ "type": "use", "tool": "healjelly", "count": 1 }`（機器を一定回数、成功させる） |
| `on_done` | ステップが終わったときに立てる・消すフラグ `{ "set_flags": […], "clear_flags": […] }` |
| `talk_after` | ステップの後の、治療を止める会話 |
| `continue_point` | このステップのあとにコンティニューポイントを置く `{ "name": "2人目の治療から" }` |

### 1.2 病巣の配置（`lesions` の1つ）

| 項目 | 内容 |
|---|---|
| `id` | 配置の名前（字幕のきっかけや `appear` で使う） |
| `type` | 病巣の種類（`lesions.json` の名前） |
| `pos` | 置く位置 `[x, y]` |
| `points` | 病巣の点を書き換える（`pos` からの相対座標。点の数も変えられる） |
| `scale`、`rotate` | 大きさ（倍率）と向き（度。時計回り） |
| `appear` | いつ出すか。書かなければステップの最初。`{ "after_sec": 10 }`（10秒後）、`{ "after": "配置のid" }`（その病巣が治ったあと。配列でも書ける） |
| `overrides` | この配置だけ、病巣データの値を上書きする（例：`{ "pool": { "amount": 40 } }`） |

### 1.3 字幕（`subtitles` の1つ）

`{ "at": きっかけ, "lines": [ { "who": "エリテ", "text": "…" }, … ] }`

- きっかけ：`"start"`（ステップの最初）、`{ "lesion": "配置のid", "stage": 1 }`（その病巣の段階が進んだとき。0 は出現、1 は1つ目の段階が終わったとき）、`{ "lesion": "配置のid", "event": "done" }`（治ったとき）。`lesion` の代わりに `"type": "病巣の種類"` も書ける。
- セリフが複数あるときは約5秒ごとに次へ進み、最後のセリフは次のきっかけまで出したままになります。

### 1.4 会話の行（`talk_before`・`briefing`・`talk_after` など）

| 書き方 | 意味 |
|---|---|
| `{ "who": "ラーゼ", "text": "セリフ" }` | セリフ。改行は `\n`。`who` が `system.json` の `characters` にあれば立ち絵を出す（「ナレーション」など、無い名前は立ち絵なし） |
| `{ "bg": "bg_clinic.svg" }` | 背景を変える（会話画面では暗転が入る） |
| `{ "fade": true }` | 背景はそのままで暗転する（時間経過） |
| `{ "bgm": "talk" }`、`{ "se": "alarm" }` | 音（セリフの行に一緒に書いてもよい） |
| `{ "hide": "left" }` | 立ち絵を消す（`left`・`right`・`all`） |
| `{ "choice": [ { "text": "A. …", "set": "フラグ名" }, … ] }` | 選択肢。選んだほうのフラグが立つ |
| どの行にも `"if": "フラグ名"`、`"if_not": "フラグ名"` | そのフラグがあるとき（無いとき）だけ出す |

## 2. 病巣（`lesions.json`）

| 項目 | 内容 |
|---|---|
| `name` | リザルトに出す名前 |
| `look` | 見た目の種類（`scratch`・`pool`・`laceration`・`shard`・`incision`・`closure`・`hematoma`・`tumor`・`vessel`・`inject`）。新しい見た目はプログラムの修正が要る |
| `shape` | 形の種類。`line`（点を結んだ線）、`ring`（点が円形に並ぶ）、`point`（1点） |
| `points` | 初期の点（配置の位置からの相対座標）。配置で書き換えられる |
| `sets` | 段階ごとに使う別の点の組（例：腫瘍のつまむ点 `lr`、縫う線 `lr_line`） |
| `width` | ヒールゼリー・テーピングで覆う範囲（線からのマス数） |
| `kind`、`pool` | 血溜まり・膿は `"kind": "pool"` と `"pool": { "amount", "grow_per_sec", "max" }`（量・自然増・最大値） |
| `steps` | 治療手順（下の表） |
| `with` | 一緒に出す病巣 `{ "lesion": "blood_pool", "at": "points" }`（`points` は点それぞれ、書かなければ中心） |
| `respawn` | 時間がかかると出る病巣 `{ "lesion", "after_sec", "before_step" }`（段階 `before_step` より前の間だけ） |
| `vital_drain` | 病巣があるあいだのバイタル減少 `{ "interval_sec", "amount" }` |
| `score` | 配点。`time`（`points`・`full_within_sec`・`zero_after_sec`）、`no_miss`、`no_skip`、`fail_penalty`。書かない項目は `system.json` の `default_score` |
| `on_fail` | `"reset"` にすると、失敗したとき手順が最初に戻る |
| `when_spawned` | メスの空振りなど、実行中に出たときだけ上書きする値 |
| `keep_after_done` | 治ったあとも見た目を残す |

手順の段階（`steps` の1つ）：

| `tool` | `action` | 追加で書ける項目 |
|---|---|---|
| `healjelly` | `cover`（塗って覆う） | `width`、`cover_threshold` |
| `drain` | `suck`（血溜まり・膿そのもの）、`pools`（この病巣から出た血溜まり・膿をすべて吸う） | - |
| `tweezers` | `carry`（掴んで運ぶ）、`tap`（点をタップして閉じる）、`connect`（端からもう片方の端へ繋ぐ） | `dest`（`"tray"` か、相対座標）、`radius` |
| `scalpel` | `cut`（通過点を順になぞる） | `closed: true`（円形） |
| `needle` | `stitch`（線をまたいで縫う） | `count`（必要な回数。書かなければ点の数） |
| `injector` | `inject`（薬を患部に打つ） | `drug`、`amount`、`radius` |
| `taping` | `tape`（テープで覆う） | - |

どの段階にも書ける項目：`heal`（成功時の回復値）、`fail_damage`（失敗時のダメージ。書かなければ機器の既定値）、`optional: true`（省略できる）、`skip_damage`（省略したときのダメージ）、`skip_penalty`（省略したときの減点）、`set`（使う点の組）、`spawn`（この段階が終わったときに出す病巣）。

## 3. 確認用の機能

URL の最後に `?debug=1` を付けて開くと、確認用の機能が出ます（付けなければ出ません）。

- タイトル画面：「確認用：セーブ消去」「確認用：全ステージ開放」
- トレーニングの病巣選択画面：「確認用：全病巣を練習可能に」
- ゲーム画面：G キーでマス目、H キーで病巣の上に今使う機器の名前
