# Türkçe başlangıç kılavuzu

CodeBudget, kodlama ajanına gönderilen komut çıktısını ve kaynak bağlamını azaltmayı amaçlayan yerel bir beta araçtır. Çıktı boyutu, tahmini token, sağlayıcı kullanımı, fatura ve abonelik kotası ayrı ölçümlerdir. Yerel replay sonucu gerçek görev tasarrufu kanıtı değildir.

## Kurulum ve ilk çalıştırma

CodeBudget kullanımı tamamen ücretsizdir; şirket içi kullanım ve araçla ticari yazılım geliştirmek buna dahildir. CodeBudget'i satmak, ticari bir ürüne eklemek, yeniden markalayarak satmak veya ticari SaaS/API hizmeti olarak sunmak için **vahapogut'un önceden yazılı izni** gerekir. Ücretli paket veya lisans sunucusu yoktur; kullandığınız üçüncü taraf IDE/model hizmetlerinin ücretleri kendilerine aittir.

Yeni lisans 0.1.0-beta.2 ile başlar. Daha önce Apache-2.0 altında yayımlanmış kodun hakları geri alınmaz; bu kodun ticari kullanımı eski lisans kapsamında mümkündür. Bağlayıcı İngilizce [lisans](../LICENSE) ve [geçiş açıklaması](../LICENSING.md) bu sınırları belirtir.

`package.json` içinde tanımlanan Node.js sürümünü ve pnpm 10.33.2 kullanın. İlk doğrulama Windows üzerinde Node 22.16.0 ile yapılmıştır; diğer platformların gerçek test durumu `docs/VERIFICATION.md` dosyasındadır.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js init
node dist/cli.js doctor
node dist/cli.js run -- node -e "console.log('CodeBudget denemesi')"
node dist/cli.js report --format json
```

Örneklerdeki `node dist/cli.js` komutları CodeBudget klasöründen çalıştırılır. Başka bir projede kullanmak için her komutta `node /tam/yol/codebudget/dist/cli.js --root /tam/yol/proje <komut>` biçimini kullanın; ilk komut `init` olmalıdır. `.codebudget.json` proje ayarıdır; `.codebudget/` yerel veriyi saklar ve Git dışında tutulur. Global IDE ayarı değiştirilmez. Genel npm paket adının kullanılabilirliği doğrulanmadığından yayımlanmış bir paket varsaymayın; yerel derlemeyi veya `pnpm pack:release` arşivini kullanın. Düz `pnpm pack`, dağıtım için kullanılan paketleme akışı değildir.

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

Çıktı değiştirme Claude Code 2.1.216 ve sonraki 2.x sürümlerinde etkindir. Hook sözleşme testleri 2.1.216 ve 2.1.285 ile çalışır; CI, kurulu eklentiyi yayımlanmış en yeni istemciyle ayrıca kontrol eder. Gerçek model oturumunda çıktının değiştiği henüz doğrulanmamıştır. Başka ana sürümlerde, tanınmayan çıktı biçimlerinde ve desteklenmeyen olaylarda anlamsal dönüşüm yapılmaz; nedeni yerelde kaydedilir ve `node dist/cli.js doctor` çıktısındaki `warnings` alanında görünür. Eklenti için `PATH` üzerinde Node.js 22.16 veya daha yenisi gerekir; eski sürümde hook araç sonucunu değiştirmeden çıkar. MCP kaydı, bütün yerleşik terminal ve dosya çağrılarını otomatik denetlemek anlamına gelmez.

## Proje yerel MCP kaydı

```sh
node dist/cli.js adapters install codex --dry-run
node dist/cli.js adapters install codex --apply --command node --arg /tam/yol/codebudget/dist/cli.js --arg mcp --arg serve
```

Önizleme yalnızca CodeBudget girdisini, dosya yollarını ve içerik özetlerini gösterir; dosyadaki diğer baytlar, biçim ve izinler korunur. Varsayılan kayıt taşınabilirdir (`codebudget mcp serve`, makineye özgü yol içermez) ve `codebudget` komutunun `PATH` üzerinde olmasını gerektirir; eksikse önizleme bunu belirtir. Kaynak klasörden çalışırken yukarıdaki gibi `--command` ve tekrarlanan `--arg` ile açık bir başlatma komutu kaydedin. `--root` verilmezse sunucu, `CLAUDE_PROJECT_DIR` ya da istemcinin başlattığı dizinden en yakın başlatılmış projeyi kullanır.

## Kaynak ve kanıtla çalışma

```sh
node dist/cli.js index
node dist/cli.js session start --task "Refresh token düzeltmesi"
# <id> yerine dönen oturum kimliğini yazın.
node dist/cli.js context --task "Refresh token yeniden kullanım hatasını düzelt" --budget 8000 --session <id>
node dist/cli.js session checkpoint --session <id>
node dist/cli.js artifact read <id> --offset 0 --limit 200
node dist/cli.js dashboard
```

Dashboard bağlantısı tek kullanımlıktır: sayfa bağlantıyı bir oturum tokenıyla değiştirir, aynı sekmeyi yenilemek çalışmaya devam eder. Yeni bağlantı için `dashboard` komutunu yeniden çalıştırın. `report` varsayılan olarak en yeni 200 komutu listeler; daha fazlası için `--limit`, `--offset`, tek kayıt için `--run <id>` veya `--context <id>` kullanın.

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

Araç çalıştırıcıya yürütülebilir dosya ve ayrı argümanlar verin; shell pipe ifadesini tek komut metni olarak geçirmeyin. `run` komutuna borudan gelen girdi, çalıştırılan komutun stdin'ine aktarılır; kapatmak için `--no-stdin` kullanın. Kanıt arşivi yazılamazsa (örneğin disk doluysa) komut yine tamamlanır ve bir uyarı yazdırılır. Yerel veri `diskBudgetBytes` sınırının yarısını geçtiğinde önce süresi dolan, sonra en eski kanıtlar silinir. Maskelenmemiş ham arşiv (`rawArchive`) ve deneysel ayarlar Git'e giren `.codebudget.json` dosyasından açılamaz; yalnızca Git dışındaki `.codebudget/local.json` dosyası veya `CODEBUDGET_RAW_ARCHIVE=1` ile etkinleşir. Hassas verileri veya dashboard erişim tokenını paylaşmayın. CodeBudget'ın yerelde çalışması mevcut IDE'nizin kendi sağlayıcısına veri göndermesini engellemez.
