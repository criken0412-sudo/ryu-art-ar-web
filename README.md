# 北澤龍の動く絵 — ブラウザ版

iOS版で使っている6点の絵と動画を使ったスマートフォン向けWebARです。iPhoneはSafari、AndroidはChromeを使い、HTTPSの公開URLから開きます。localhost以外では、カメラにHTTPSが必要です。

## 作品

最初の作品と作品1は1回再生し最終フレームを残します。作品2〜5はループ再生します。作品4・5は絵から動画へ2秒かけて切り替わります。ホームの「作品」からは静止画だけを表示します。

## Windowsで起動

Node.js 20以降を用意し、webフォルダーで次を実行します。

```powershell
npm install
npm run compile-targets
```

画像認識データを一度作成します。コンパイルはローカルのブラウザ内で行い、素材画像を外部サービスへ送信しません。MindARの処理はWebGLを使うため、Microsoft EdgeまたはChromeの通常ブラウザで /tools/compile-targets.html を開き、「作成を開始」を押します。作成後、public/targets.mind ができます。

```powershell
npm run dev -- --host 0.0.0.0
```

パソコンでは表示されたlocalhostのURLで確認できます。スマートフォンのカメラを使うには公開されたHTTPSのURLが必要です。スマートフォンから公開URLを開き「絵にカメラを向ける」を押し、カメラを許可します。

## 公開ビルド

```powershell
npm run build
```

ryu-art-ar-web というGitHubリポジトリにこのフォルダーの中身を置き、Pagesの公開元をGitHub Actionsにすると、.github/workflows/pages.yml が自動公開します。公開先は https://criken0412-sudo.github.io/ryu-art-ar-web/ です。GitHub Pagesは公開サイトとなり、収録した画像・動画もURLから取得できるため、公開前に了承を得てください。別のパスに置く場合は VITE_BASE_PATH を変更します。

動画は初めて対応する絵を認識した後に各1本ずつ読み込みます。カメラ映像は保存・送信しません。

## 開発

アプリ本体はsrc/main.jsとsrc/style.css、WebAR認識データ作成はtools/compile-targets.js、既存の原本素材はpublic/media/です。対象絵の順番とtargets.mindのインデックス順を一致させてください。MindARとThree.jsの利用条件はそれぞれのライセンスを確認してください。
