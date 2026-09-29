# Türkçe başlangıç kılavuzu

CodeBudget, kodlama ajanına gönderilen komut çıktısını ve kaynak bağlamını azaltmayı amaçlayan yerel bir beta araçtır. Çıktı boyutu, tahmini token, sağlayıcı kullanımı, fatura ve abonelik kotası ayrı ölçümlerdir. Yerel replay sonucu gerçek görev tasarrufu kanıtı değildir.

## Kurulum ve ilk çalıştırma

`package.json` içinde tanımlanan Node.js sürümünü ve pnpm 10.33.2 kullanın. İlk doğrulama Windows üzerinde Node 22.16.0 ile yapılmıştır; diğer platformların gerçek test durumu `docs/VERIFICATION.md` dosyasındadır.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js init
node dist/cli.js doctor
node dist/cli.js run -- node -e "console.log('CodeBudget denemesi')"
node dist/cli.js report --format json
```

Başka projede kullanmak için `node /tam/yol/codebudget/dist/cli.js --root /tam/yol/proje init` çalıştırın. `.codebudget.json` proje ayarıdır; `.codebudget/` yerel veriyi saklar ve Git dışında tutulur. Global IDE ayarı değiştirilmez. Genel npm paket adının kullanılabilirliği doğrulanmadığından yayımlanmış bir paket varsaymayın; yerel derlemeyi veya `pnpm pack:release` arşivini kullanın. Düz `pnpm pack`, dağıtım için kullanılan paketleme akışı değildir.

Varsayılan `observe` modunda anlamsal azaltım uygulanmaz. Hassas bilgi maskeleme ayrı güvenlik işlemidir. Azaltımı açıkça etkinleştirmek için:

```sh
node dist/cli.js config mode balanced
```

## Claude Code eklentisi

```sh
pnpm build
claude --plugin-dir /tam/yol/codebudget/plugins/claude-codebudget
```

Eklenti kısa bir skill, üç sınırlı MCP aracı ve doğrulanan olay biçimleri için hook içerir. Claude'un normal komut izinlerini koruyun. Kaldırmak için sonraki başlatmada `--plugin-dir` seçeneğini kullanmayın. Aynı MCP sunucusunu ayrıca proje ayarına kaydederek iki kopya oluşturmayın.

Hook sözleşmesi Claude Code 2.1.216 için test edilmiştir. Gerçek model oturumunda çıktının değiştiği henüz doğrulanmamıştır. Bilinmeyen sürümlerde ve desteklenmeyen olaylarda anlamsal dönüşüm yapılmaz. MCP kaydı, bütün yerleşik terminal ve dosya çağrılarını otomatik denetlemek anlamına gelmez.

## Kaynak ve kanıtla çalışma

```sh
node dist/cli.js index
node dist/cli.js context --task "Refresh token yeniden kullanım hatasını düzelt" --budget 8000
node dist/cli.js session start --task "Refresh token düzeltmesi"
node dist/cli.js session checkpoint --session <id>
node dist/cli.js artifact read <id> --offset 0 --limit 200
node dist/cli.js dashboard
```

İndeks kaydedilmiş dosyaları okur; editörde kaydedilmemiş değişiklikleri göremez. JS/TS/JSX/TSX için Tree-sitter, diğer dosyalarda açıkça belirtilen metin arama fallback'i kullanılır. Paket gerekli kaynakları bütçeye sığdıramıyorsa bunu bildirir; tahmini token sayımı sağlayıcı faturasının kesin ölçümü değildir.

Desteklenen yerel kodlamayla çevrimdışı token sayımı için:

```sh
node dist/cli.js context --task "Refresh token düzeltmesi" --budget 8000 --tokenizer o200k_base --model gpt-4o
```

Kalıcı ayar için `.codebudget.json` dosyasındaki mevcut alanları koruyarak şu alanları ekleyin:

```json
{
  "contextTokenizer": { "encoding": "o200k_base", "model": "gpt-4o" },
  "contextDependencies": { "maxDepth": 2, "maxFiles": 64 }
}
```

Tokenizer seçenekleri varsayılan `estimated`, `o200k_base` ve `cl100k_base` değerleridir. Paketlenmiş kodlamalar çevrimdışı çalışır; yalnızca denetlenen serileştirilmiş metni sayar, gizli promptları veya faturayı ölçmez. Model eşlemesi bilinmiyorsa açık bir uyarıyla bayt tahminine dönülür; bilinen model/kodlama uyumsuzluğu reddedilir. Claude'a özel kodlama desteği iddia edilmez. Bağımlılık genişletmesi varsayılan olarak 2 derinlik ve 64 dosyayla sınırlıdır; izin verilen aralıklar 0–8 ve 0–512'dir. Bu sınırlar bağlam token bütçesinden ayrıdır. Ayrıntılar: [indeks ve bağlam](INDEXER.md).

## Kullanım kapsamını inceleme

```sh
node dist/cli.js usage import --file capture.jsonl --format codex-jsonl --client-version 0.139.0 --import-id my-capture-001
node dist/cli.js report --format json
```

Aynı kaydı yeniden içe aktarırken aynı `--import-id` değerini kullanın. Araç yalnızca verdiğiniz dosyayı okur; hesaba bağlanmaz. Rapordaki `observedUsage.coverage`, eksik alanları, ölçüm kaynaklarını, kümülatif sayaçları ve sınırlı alt ajan atfını gösterir. Gözlemlenmeyen çağrılar ve tam kapsama oranı bilinmiyor olarak kalır. Ayrıntılar: [kullanım kapsamı](USAGE_COVERAGE.md).

## Test ve ölçüm

```sh
pnpm verify
pnpm smoke:package
node dist/cli.js benchmark replay
node dist/cli.js benchmark tasks --dry-run
```

Bu komutlar ücretli model çağrısı yapmaz. Replay yalnızca kayıtlı/sentetik çıktıları ölçer. Otuz görevlik pilotun gerçek model koşuları yapılmamıştır. Gerçek sonuçlar, çalıştırılmayan doğrulamalar ve kalan riskler `docs/VERIFICATION.md`, `docs/STATUS.md` ve `docs/BENCHMARKS.md` içinde tutulur.

Model deneyleri, ücretli çağrılar, global IDE ayar değişiklikleri ve npm yayını ayrıca açık yetki gerektirir.

Araç çalıştırıcıya yürütülebilir dosya ve ayrı argümanlar verin; shell pipe ifadesini tek komut metni olarak geçirmeyin. Hassas verileri veya dashboard erişim tokenını paylaşmayın. CodeBudget'ın yerelde çalışması mevcut IDE'nizin kendi sağlayıcısına veri göndermesini engellemez.
