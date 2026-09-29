# CODEBUDGET — UÇTAN UCA GELİŞTİRME GÖREVİ

## 1. Rolün ve teslim edeceğin ürün

Bu depoda kıdemli bir yazılım mimarı, geliştirici araçları mühendisi ve test mühendisi olarak çalış. Görevin yalnızca fikir, mimari doküman veya kod iskeleti üretmek değil; CodeBudget isimli açık kaynak, local-first bir geliştirici aracını uygulamak, çalıştırmak, test etmek ve dağıtıma hazırlanabilir hale getirmektir.

CodeBudget; Claude Code, OpenAI Codex, Cursor ve Google Antigravity gibi AI kodlama araçlarında gereksiz bağlamı, büyük araç çıktılarını, tekrarlı keşifleri ve sonuçsuz ajan döngülerini azaltmayı amaçlayacak.

Ürün ilkesi:
“Modele bütün depoyu değil gerekli kodu; bütün logu değil gerekli kanıtı; bütün geçmişi değil güncel görev durumunu ver. Gerektiğinde kaynak ayrıntılarını geri getir.”

Başarı ölçütü en az token değil, kalite korunarak doğru tamamlanan görev başına daha az toplam tüketimdir. Token azaltımını, API maliyetini ve abonelik kotasını aynı şey olarak ele alma. Kanıt olmadan tasarruf yüzdesi vaat etme.

Bu metin uygulanacak ürün şartnamesidir. Buradaki komutlar ve arayüzler hedeflenen CodeBudget sözleşmeleridir; mevcut IDE özellikleri olduklarını varsayma.

Kullanıcıyla Türkçe iletişim kur. Kod, isimlendirmeler, ana README, API belgeleri ve katkı dokümanları İngilizce olsun. Türkçe bir başlangıç kılavuzu da hazırla.

## 2. Çalışma şeklin ve oturum sürekliliği

Önce mevcut depoyu, AGENTS.md talimatlarını, Git durumunu, araç zincirini ve mevcut testleri incele. Var olan projeyi gereksiz yere yeniden kurma. Kullanıcı değişikliklerini koru; ilgisiz dosyaları silme, resetleme veya yeniden biçimlendirme.

Boş depoda aşağıdaki yapıyı oluştur. Dolu depoda mevcut mimariye uyarlayarak ilerle. Olağan teknik belirsizliklerde makul varsayım seç, gerekçesini kaydet ve devam et. Her aşamada kullanıcıdan “devam edeyim mi?” onayı isteme.

Bununla birlikte yetki sınırlarını koru: ücretli model çağrıları, hesap bağlantıları, global IDE ayarlarının gerçekten değiştirilmesi, uzaktaki depoya push, npm yayını, bulut dağıtımı ve yıkıcı işlemler ayrı açık yetkilendirme gerektirir. Bu işlemler olmadan geliştirilebilen parçaları tamamla.

İlk aşamada şu dosyaları oluştur veya mevcut karşılıklarını güncelle:

- AGENTS.md: Kısa proje kuralları, gerçek doğrulama komutları ve yürütme planının yolu.
- docs/PRODUCT_SPEC.md: Bu şartnamenin ürün gereksinimleri ve kapsam sınırları.
- docs/EXECUTION_PLAN.md: Aşamalar, bağımlılıklar, kabul koşulları ve ilerleme.
- docs/RESEARCH.md: Doğrulanan resmi belgeler, sürümler ve entegrasyon sınırları.
- docs/DECISIONS.md: Önemli teknik kararlar ve gerekçeleri.
- docs/STATUS.md: Son doğrulanan durum, açık sorunlar ve bir sonraki somut adım.
- docs/VERIFICATION.md: Gerçek çalıştırılan testler ve sonuçları.

AGENTS.md içine bütün şartnameyi kopyalama. Mümkünse 100 satırın altında tut. Ayrıntıları ilgili belgelerde bırak; her görevde bütün belgeleri ve depoyu tekrar okuma.

Her gereksinime kimlik ver. Yürütme planında durumları pending, in_progress, verified, blocked_external veya deferred_experimental olarak takip et. Zor bir gereksinimi açıklamasız biçimde kapsamdan çıkarma. verified için dosya, test veya çalıştırma kanıtı göster.

Her aşamada küçük bir çalışan dikey dilim teslim et: uygula, ilgili testi çalıştır, hatayı düzelt, belgeleri güncelle, sonraki aşamaya geç. İlk yanıtını yalnızca planla bitirme; ortam izin veriyorsa aynı çalışma içinde kodlamaya başla.

Oturum sonlanırsa veya bağlam daralırsa STATUS.md dosyasına tamamlananları, başarısız testleri, tam komutları, değişen dosyaları ve sıradaki işi kaydet. Sonraki oturum, sohbet geçmişine ihtiyaç duymadan bu dosyalardan devam edebilsin. Henüz yapılmamış bir işi tamamlandı diye işaretleme.

## 3. Önce entegrasyon gerçeklerini doğrula

Kullandığın IDE hook’ları, MCP yapılandırmaları, kullanım metrikleri, SDK’lar ve paket sürümleri için güncel resmi belgeleri kontrol et. Başlangıç kaynakları:

    https://developers.openai.com/codex/
    https://code.claude.com/docs/
    https://cursor.com/docs
    https://antigravity.google/docs
    https://modelcontextprotocol.io/
    https://nodejs.org/en/about/previous-releases
    https://tree-sitter.github.io/tree-sitter/
    https://www.sqlite.org/fts5.html

Adresler yönlendirilmişse güncel resmi karşılığını kullan. RESEARCH.md içinde kontrol tarihi, kaynak URL, ilgili istemci/SDK sürümü, doğrulanan yetenek ve belirsizlikleri kaydet.

Hook adlarını, JSON alanlarını, ayar dosyası yollarını, kullanım endpoint’lerini veya gizli API’leri uydurma. Desteklenmeyen bir özelliği genel proxy ile çalışıyor gibi gösterme. Bir istemcinin API’sini diğerine uyarladığını varsayma.

İnternet veya istemci erişimi yoksa bağımsız çekirdeği ve sözleşme testlerini geliştir. Entegrasyonu “uygulandı, gerçek istemcide doğrulanmadı” diye işaretle. Sahte başarı üretme.

RTK, Serena, Aider ve Context Mode gibi benzer projelerin kendi belgelerini ve lisanslarını kısa bir karşılaştırma için incele. Yeniden kullanım teknik ve lisans bakımından uygunsa değerlendir. Başkasının benchmark sonucunu CodeBudget sonucu diye sunma. Araştırmayı uzatıp kodlamayı erteleme.

## 4. Mimari ve teknoloji kararları

Başlangıç tercihi TypeScript strict mode, desteklenen Node.js LTS ve pnpm workspace olsun. Uyumlu kararlı sürümleri doğrula, packageManager/engines alanlarını tanımla ve lockfile üret. Sürümleri tahmin ederek yazma.

Yerel veri için SQLite ve FTS5; kod yapısı için Tree-sitter kullan. SQLite sürücüsünü ve Tree-sitter bağlayıcısını küçük bir kurulum/çalıştırma deneyiyle doğrula. Native bağımlılıkların paketleme sorunlarını görünür kıl. Gerekli grammar/WASM dosyaları çalışma sırasında internet gerektirmeden kullanılabilsin.

Yerel dashboard için React + Vite, birim/entegrasyon testleri için Vitest, tarayıcı uçtan uca testleri için Playwright tercih et. MCP için güncel resmi SDK’yı kullan. Gerekçeli uyumsuzluk varsa en küçük değişikliği yapıp DECISIONS.md dosyasına kaydet.

Mantıksal sınırlar:

    apps/cli
    apps/dashboard
    packages/core
    packages/reducers
    packages/indexer
    packages/mcp
    packages/adapters
    packages/benchmarks
    tests/fixtures
    examples
    docs

Core; domain tipleri, konfigürasyon, güvenlik, SQLite erişimi, bütçe, görev durumu ve kullanım kayıtlarını içerir. Adaptörler core arayüzlerini kullanır; core belirli bir IDE’ye bağımlı olmaz.

Mikroservis, Kubernetes, zorunlu Docker, zorunlu GPU, vektör veritabanı, kullanıcı hesabı veya bulut backend’i kurma. CLI gerektiğinde çalışsın; MCP ve dashboard yalnızca kullanıcı başlattığında uzun yaşayan süreçler olsun. İlk sürüm için sürekli daemon zorunlu olmasın.

Çekirdek, bağımlılık kurulumu sonrasında API anahtarı olmadan çevrimdışı çalışabilsin. AI sağlayıcısına istek göndermek temel işlevlerin gereği olmasın.

## 5. CLI ve konfigürasyon sözleşmesi

Aşağıdaki işlevleri gerçekten çalışan CLI komutlarıyla sun:

    codebudget init
    codebudget doctor
    codebudget index
    codebudget run -- pnpm test
    codebudget context --task "Fix refresh token rotation" --budget 8000
    codebudget artifact read <id> --offset 0 --limit 200
    codebudget session start --task "Fix refresh token rotation"
    codebudget session checkpoint --session <id>
    codebudget session close --session <id>
    codebudget report --session <id>
    codebudget report --format json
    codebudget adapters inspect
    codebudget adapters install <client> --dry-run
    codebudget adapters install <client> --apply
    codebudget adapters uninstall <client> --dry-run
    codebudget adapters uninstall <client> --apply
    codebudget mcp serve
    codebudget dashboard
    codebudget benchmark replay
    codebudget benchmark tasks --dry-run
    codebudget data prune --dry-run

Eksik kalan parametreleri tutarlı biçimde tasarla ve --help çıktılarında belgele. Büyük metni CLI argümanına zorlamak yerine gerektiğinde stdin veya dosya girdisi destekle.

init yerel proje yapılandırmasını ve veri dizinini oluştursun; global ayarları değiştirmesin. Aktif mod varsayılan olarak observe olsun. İlk bütçe örneği 8.000 token olabilir; bunu evrensel optimum diye sunma. Çıktı, bağlam, artifact saklama süresi ve disk limitleri ayrı ayarlanabilsin.

Konfigürasyon sürümlü şemaya sahip olsun. Geçersiz alanlara açıklayıcı hata ver. Ortam değişkeni/CLI/proje ayarı önceliğini belgele. Veri dizinini Git dışında tut; hassas bilgileri konfigürasyona gömme.

Kurulum değişikliklerini önizle, mevcut dosyayı yedekle, yapısal olarak birleştir ve atomik yaz. Tekrar kurulum aynı girdiyi çoğaltmasın. Kaldırma yalnızca CodeBudget’ın eklediklerini temizlesin; kullanıcının sonradan yaptığı düzenlemeleri eski yedekle ezmesin. Testlerde gerçek home yerine geçici dizin kullan.

## 6. Güvenli komut çalıştırıcı ve çıktı arşivi

run komutu, açıkça verilen executable + argv dizisini çalıştırsın. Varsayılan olarak shell string birleştirme veya eval kullanma. Shell gerektiren durumları ayrı, açık ve test edilmiş politika olarak ele al.

Çocuğun exit code, signal, timeout, cwd ve çalışma süresini koru. stdout/stderr ayrımını ve gözlenen chunk sırasını kaydet. Wrapper hatasını çocuk süreç hatasından ayır. İptalde desteklenen platformlarda alt süreçleri temizle.

Backpressure, büyük çıktı, disk dolması, bozuk UTF-8, ANSI kontrol dizileri ve yarım satırları test et. Çıktının tamamını sınırsız RAM’e alma. Boyut sınırına ulaşılırsa bunu açıkça bildir; kesilmiş çıktıyı eksiksizmiş gibi sunma.

İnteraktif/TTY komutlarını otomatik optimize etme. Pipe, redirect, command substitution ve karmaşık shell ifadelerini semantiği korunamıyorsa yeniden yazma. Bir komutu ölçüm amacıyla ikinci kez çalıştırma.

Model için sadeleştirilmiş çıktı ile makine tüketicisine gereken ham/structured çıktı farklıdır. JSON veya patch bekleyen downstream sürecin girdisini özetle değiştirip bozma. Otomatik dönüşümleri yalnızca doğrulanan ajan çıktı yoluna uygula.

Varsayılan arşiv, tam fakat gizli bilgileri maskelenmiş çıktı olsun. Sansürsüz ham çıktı kalıcı saklama ancak açık yerel opt-in ile açılsın; MCP veya dashboard üzerinden otomatik dışarı verilmesin. Artifact’ın maskelenmiş, kesilmiş veya tam olduğunu metadata’da belirt.

Artifact kimliklerini repository/session kapsamına bağla. Sayfalı okuma, içerik hash’i, saklama süresi ve disk bütçesi uygula. read işlemi komutu tekrar çalıştırmasın. Hassas veri filtresi başarısızsa model yönüne içerik gönderme.

## 7. Çıktı azaltıcıları

İlk gerçek ayrıştırıcılar: Vitest/Jest test sonuçları, TypeScript derleyici hataları, ESLint bulguları, git status, git diff, arama sonuçları, JSON yanıtları ve tekrarlı loglar olsun.

Doğrulanmış structured çıktı mevcutsa onu tercih et; insan okunur formatlar için sürümlü fixture testleri kullan. Tanınmayan formatta agresif kırpma yapma. Güvenli tam çıktı veya açıkça belirtilmiş sayfalı okuma yoluna dön.

Her reducer için supports, parse, reduce ve preservation validation davranışlarını tanımla. Dönüşüm deterministik olsun. Aynı çıktının iki kez sıkıştırılmasını metadata ile önle. Kazanç sağlamayan dönüşümü uygulama.

Korunması zorunlu bilgiler: başarısızlık durumu, exit code, başarısız test adları, hata mesajı, beklenen/gerçek değer, gerekli dosya/satır konumları, skipped/cancelled sayıları, gerekli stack trace bölümleri ve kesilme bilgisi.

Başarılı test satırlarını gruplayabilirsin; başarısız testleri gizleyemezsin. Aynı logu gruplayabilirsin; tekrar sayısını, zaman aralığını ve değişken ayrıntılara erişimi korumalısın. git diff özetini gerçek patch gibi sunamazsın.

Çıktı şeması en az şunları içersin:

    schemaVersion, status, exitCode, summary, diagnostics,
    artifactId, detailsAvailable, truncated,
    originalSize, reducedSize, reducerId, reducerVersion

Boyut azalmasını aynı tokenizer ve aynı güvenlik-redaksiyon sınırı üzerinde hesapla. Karakter/byte/token ölçülerini karıştırma. Güvenlik maskelemesinden doğan azalmayı anlamsal optimizasyon kazancı diye sayma.

## 8. Depo indeksi ve görev odaklı kod seçimi

İlk dil kapsamı JavaScript, TypeScript, JSX ve TSX olsun. Diğer dillerde açıkça belirtilmiş metin arama fallback’i kullan; semantik destek varmış gibi davranma.

İndeks dosyalar, semboller, imzalar, gövdeler, export/import ilişkileri, kaynak aralıkları, test dosyası adayları ve içerik hash’lerini tutsun. Git tarafından izlenmeyen ama kapsam içindeki dosyaları ve kaydedilmiş çalışma ağacı değişikliklerini de ele al.

.gitignore ile .codebudgetignore kurallarını uygula. node_modules, build çıktıları, vendor, büyük binary dosyalar, .git, veri arşivi, .env ve anahtar dosyalarını varsayılan dışla. Hassas yol kuralları normal include kurallarıyla yanlışlıkla geçersizleşmesin.

Symlink, path traversal, Windows yol biçimleri, Unicode dosya adları, silinen/yeniden adlandırılan dosyalar, worktree’ler ve aynı anda indeksleme durumlarını test et. Yetkili repository kökü dışındaki dosyaları okuma.

Görev seçiminde dosya/sembol adı, hata konumu, FTS5 metin eşleşmesi, doğrudan bağımlılıklar ve ilişkili testleri birlikte kullan. İlk sürüm embedding gerektirmesin.

Tree-sitter’dan tam tip çözümleme veya kusursuz çağrı grafiği çıkardığını iddia etme. Referans ilişkilerinin doğrulanmış mı heuristik mi olduğunu belirt. Dinamik import, reflection ve belirsiz referanslarda güveni düşürüp bağlam genişletme öner.

Sözdizimi bozuk veya yarım dosyaları güvenli biçimde ele al. Destek sınırı raporunu ve indeks güncellik kontrolünü doctor komutuna ekle.

## 9. Bağlam bütçesi motoru

prepare_context işlemi görev, repository, session ve token bütçesi alarak kaynak izlenebilirliği olan bir ContextPackage üretsin.

Paket; görev amacı, kabul kriterleri, zorunlu kısıtlar, ilgili gerçek kod, gerekli tip/import bilgisi, test kanıtı, dahil edilme gerekçeleri, atlanan adaylar ve ayrıntı referanslarını içersin.

Düzenlenecek fonksiyonun gerçek gövdesini yalnızca doğal dil özetiyle değiştirme. Kullanıcının açıkça istediği kaynakları ve gerekli güvenlik/arayüz sözleşmelerini zorunlu içerik olarak tut.

İlk seçim algoritması deterministik ağırlıklı sıralama olabilir: görev ilişkisi, hata kanıtı ve bağımlılık önemi / token maliyeti. Ağırlıkları konfigüre et; bunları istatistiksel güven olasılığı diye gösterme. Kararlı tie-break ve paket sıralaması kullan.

Bütçeyi yalnızca tekil kod parçalarında değil, son serileştirilmiş CodeBudget paketinde ölç. Başlıklar, yollar, metadata ve kontrol ettiğimiz protokol zarfını hesaba kat. Görülemeyen IDE sistem promptunu veya sağlayıcı iç tokenlarını saydığını iddia etme.

Tokenizer arayüzünde yöntem, model/tokenizer kimliği ve exact_local/estimated ayrımı bulunsun. Yerel kesin sayımın sağlayıcının toplam faturalandırmasıyla aynı şey olmadığını açıkça belirt. Tokenizer bilinmiyorsa muhafazakâr tahmin kullan, kesin bütçe garantisi verme.

Zorunlu içerik bütçeye sığmazsa sessizce kesme. minimumRequiredTokens veya tahmini karşılığını, eksik kaynakları ve genişletme gereğini raporla. Büyük fonksiyonlarda açıkça eksik işaretlenmiş kaynak aralıkları sunabilirsin; tam gövde sağlandı deme.

Eksik tip, yeni hata konumu, çözümlenmeyen bağımlılık veya belirli kaynak isteğinde kademeli genişletme yap. Genişletme sayısı ve toplam maliyet görünür olsun. Sonsuz küçük retrieval çağrıları yerine ilgili parçaları kontrollü grupla.

İndeks hazırlanırken kaynak değişirse yeniden doğrula veya snapshot tutarsızlığını bildir. Yanlış satır aralığını güncelmiş gibi gönderme.

## 10. Önbellek, görev hafızası ve döngü kontrolü

Sabit proje kurallarını ve çıktı biçimini kararlı tut. Her turda bütün geçmişi yeniden özetleyerek ortak prompt başlangıcını değiştirme. Kapalı IDE’de kontrol edilmeyen cache davranışını kontrol ediyoruz deme.

Cache anahtarları repository/worktree kimliği, içerik hash’i, parser/reducer sürümü, güvenlik politikası ve ilgili konfigürasyonu kapsasın. Güncel kaynak hash’ini doğrulamadan cache içeriğini kullanma. Farklı depo veya kullanıcı verisini karıştırma.

Test sonucunu cache’ten getirip yeni test çalıştırılmış gibi sunma. Komut sonucu arşivi tarihsel kanıttır; yeni doğrulamanın yerine geçmez.

Görev kaydı şunları içersin: amaç, kabul kriterleri, kapsam dışı alanlar, kullanıcı kısıtları, doğrulanmış bulgular, varsayımlar, değişen dosyalar, test kanıtları, açık sorular ve sonraki adım.

Bulgular ile tahminleri ayır; kaynak ve sürüm bilgisi ekle. Modelin gizli muhakemesini toplamaya çalışma. Bir özetin içine alınan kaynak metni yeni sistem talimatı haline getirme.

Oturumda gönderilen kaynakları bir context epoch içinde izle. Yeni oturum, temizleme veya compaction güvenilir biçimde tespit edilirse görünürlük varsayımlarını sıfırla. Olay görülemiyorsa “daha önce gönderildi, hâlâ biliyor” varsayımını kullanma.

Değişiklik paketi oluştururken yalnız commit’e değil mevcut dosya içeriklerine bak. Silme, rename, dirty worktree ve kullanıcı tarafından alınmış değişiklikleri destekle. Kaydedilmemiş editör buffer’larına erişim yoksa bunu açıkça belirt.

Tekrarlı döngü tespiti; normalize komut, ilgili kaynak hash’leri ve hata imzasını kullansın. Aynı başarısızlık değişiklik olmadan yinelenirse uyarı üret. Meşru tekrarları otomatik engelleme; varsayılan davranış gözlem/öneri olsun. Alt ajan tüketimini ana ajan tüketiminden gizleme.

## 11. MCP ve dört IDE adaptörü

MCP sunucusunu varsayılan stdio transport ile sun. stdout yalnızca protokol mesajları taşısın; loglar stderr’e gitsin. Şema doğrulama, timeout, cancellation, girdi/çıktı limitleri ve repository/session izolasyonu uygula.

İlk MCP yüzeyi üç araç olsun:

    prepare_context(task, budget, sessionId?)
    read_evidence(id, offset?, limit?)
    get_changes(since, sessionId?)

Bu araçlar küçük ve açık şemalara sahip olsun. Gerekçesiz onlarca araç ekleme. Genel amaçlı sınırsız shell, dış URL fetch veya tüm filesystem’i okuyabilen araç açma. read_evidence yalnızca yetkili kaynak/artifact referanslarını çözsün; arbitrary path kabul etmesin.

Claude Code, Codex, Cursor ve Antigravity için ayrı adaptör geliştir. Her birinde şu yetenekleri birbirinden bağımsız değerlendir:

    MCP registration
    command routing
    tool-output replacement
    usage import
    session lifecycle events
    safe install/uninstall

Her yetenek için istemci sürümü, belge kaynağı, uygulama durumu ve doğrulama düzeyi tut. “Supported”, “unsupported”, “unknown” ile “contract-tested” ve “verified-in-client” farklı alanlar olsun.

Yalnızca ilgili istemcinin resmi olarak izin verdiği noktalarda müdahale et. Hook gözlem yapabiliyor ama çıktıyı değiştiremiyorsa bunu dönüşüm desteği diye işaretleme. Ek bağlam ekleyen hook’u eski çıktıyı kaldırıyormuş gibi değerlendirme.

Güvenli MCP/CLI yolunu tüm doğrulanmış istemciler için temel entegrasyon olarak sun; hook optimizasyonlarını yetenek bazlı ekle. İstemci kurulu değilse geçici konfigürasyonla sözleşme testleri yap, gerçek istemci doğrulamasını ayrı açık iş olarak bırak.

İstemciye uygun kısa ve geri alınabilir proje talimatı/skill örneği de üret; ajanın CodeBudget araçlarını ne zaman kullanacağını açıkla. MCP kaydını bütün yerleşik dosya/terminal çağrılarının otomatik kontrolü gibi sunma. Görülebilen CodeBudget çağrılarıyla bypass edilen çağrıları ayır; gözlenemeyenleri sıfır sayma.

Komut sarmalama, orijinal komutun izin/onay kontrolünü atlatmamalı. codebudget run arkasına bütün komutları koyarak genel bir izin kazanma. Onay semantiği korunamıyorsa otomatik yönlendirmeyi devre dışı bırak.

Hook reentrancy, iki kez sıkıştırma, bozuk event JSON’u, sürüm değişimi, stdout protokol kirlenmesi ve kurulum rollback testleri yaz. Bilinmeyen istemci sürümünde güvenli, değişiklik yapmayan moda dön.

TLS interception, cookie/session çıkarma, kota atlatma, gizli endpoint kullanımı veya aboneliği API proxy’si üzerinden taklit etme uygulama.

## 12. Modlar ve kullanım ölçümü

Observe: Optimizasyon dönüşümleri uygulanmaz; erişilebilen kullanım ve aday kazançlar gözlenir. Güvenlik redaksiyonunun ayrı bir işlem olduğunu belirt. Tam erişim yoksa kapsamı göster.

Balanced: Doğrulanmış reducer’lar, görev odaklı bağlam seçimi ve kontrollü ayrıntı getirme aktiftir. Kaliteyi riske atan, net çıktı kazancı sağlamayan veya formatı belirsiz dönüşümler uygulanmaz.

Experimental: Agresif bütçe, deneysel hafıza/devretme ve isteğe bağlı model işlevleri ayrı feature flag ile açılır. Varsayılan değildir; mevcut güvenlik sınırlarını gevşetmez.

Kullanım kayıtları şu ayrımı korusun:

    provider_reported
    client_reported
    locally_estimated

Her olayda eventId, schemaVersion, timestamp, repositoryId, sessionId, taskId, correlationId, source, scope ve erişilebilen model bilgisi olsun. Bilinmeyen değer null/unknown olsun; sıfır yazma.

Input, cached input, cache write, output ve reasoning alanlarının kapsama ilişkisini sağlayıcı bazında tanımla. Bir alt alanı toplamın üzerine ikinci kez ekleme. Aynı olayın hook, CLI ve metrik importundan gelmesi halinde çift sayımı engelle. Kümülatif ve tekil sayaçları karıştırma.

Desteklenen resmi metrik/OTel veya dışa aktarım biçimleri için sürümlü importer yaz. Otomatik keşif yoksa kullanıcı tarafından sağlanan dosyayı içe alabilsin. Hesapları scrape etme. Görevle ilişkilendirilemeyen toplam metrikleri zorla görev bazına dağıtma.

Maliyet ancak doğrulanmış fiyat, para birimi, fiyat tarihi ve kullanım sınıfı varsa hesaplansın. Aksi halde bilinmiyor yaz. Yerel tokenizer tahminini fatura veya abonelik kotası tüketimi diye etiketleme.

Raporlar üç şeyi ayrı göstersin: yerel çıktı küçülmesi, gözlenen toplam kullanım ve karşılaştırmalı görev deneyiyle ölçülen net fark. Tek bir gerçek oturumdan gözlenmeyen karşı-olgusal toplam tasarruf üretme.

Şema overhead’i, ek retrieval çağrıları, yeniden denemeler, özet üretimi ve alt ajan tüketimi net değerlendirmeye dahil olsun. Yüzdelerin ortalamasını toplam tasarruf diye sunma; uygun toplamları ve ağırlıkları kullan.

## 13. Yerel dashboard

Dashboard gerçek SQLite verisini kullansın. Sahte grafik, hardcoded tasarruf veya boş işlevli butonlarla tamamlanmış izlenimi verme. Demo gerekiyorsa ayrı veri kümesi ve görünür DEMO etiketi kullan.

Ekranlar: genel görünüm, oturum listesi, oturum ayrıntısı, çıktı karşılaştırması, bağlam paketi inceleme, benchmark raporu ve adaptör sağlık ekranı.

Gösterilecek alanlar: ölçüm kaynağı ve kapsamı, önce/sonra çıktı boyutu, geri getirilen ayrıntılar, toplam çağrılar, varsa gerçek kullanım, kalite/test sonucu, ek süre ve doğrulanmış destek durumu.

Veri yok, ölçüm eksik, sağlayıcı kapalı ve test sonucu bilinmiyor durumları tasarlanmış olsun. JSON/CSV dışa aktarmada redaksiyon ve CSV formula injection koruması uygula.

Yerel sunucu loopback’e bağlansın. Loopback’i tek başına yeterli güvenlik sayma: yerel erişim tokenı/oturumu, Origin/Host doğrulaması, CSRF ve DNS-rebinding önlemleri uygula. API’yi yerel başka bir web sayfasının okuyamayacağını test et.

Log ve kodu güvenli metin olarak göster; HTML/ANSI üzerinden script yürütme. CSP, klavye erişimi ve erişilebilir etiketler ekle. CDN, uzaktaki font, analytics ve otomatik dış ağ isteği kullanma.

## 14. Benchmark ve kalite kanıtı

İki ayrı test sistemi geliştir.

A. Replay benchmark: Aynı kaydedilmiş çıktıyı reducer’lardan geçir. Boyut farkını, korunması gereken bilgileri, süreyi ve bellek davranışını ölç. Bu sonucu uçtan uca görev veya kota tasarrufu diye sunma.

B. Task benchmark: Aynı başlangıç repo durumunda aynı görevi baseline ve CodeBudget koşullarında çalıştır. Model/ayar, izin, başlangıç dosyaları, süre/deneme sınırları ve kabul kriterlerini kaydet.

En az 30 küçük, kendi ürettiğimiz veya yeniden dağıtımı uygun görevden oluşan pilot küme hazırla. Hata düzeltme, tip hatası, regresyon testi, sınırlı refactor ve log teşhisi içersin. Fixture/şema testini gerçek model koşusu diye sayma.

Koşullar native baseline, makul yerleşik optimizasyonlu baseline ve CodeBudget olsun. Uygun olduğunda mevcut benzer aracı ayrı koşul olarak ekle. Bilerek kötü baseline oluşturma.

Koşu sırasını randomize et, birden fazla tekrar destekle, model/istemci sürümünü sabitle. Cache koşullarını kaydet; kontrol edemediğin cache’i “cold” veya “warm” diye uydurma. Değerlendirici testleri ajanın görev bağlamından ayrı tut.

Başarıyı ajanın “tamamlandı” mesajıyla değil test, typecheck ve göreve özgü doğrulayıcıyla ölç. Test geçmesiyle genel davranış eşdeğerliğinin kanıtlandığını iddia etme. İnsan incelemesi gereken görevleri işaretle.

Başarısız denemeleri maliyet hesabından çıkarma. Toplam tüketim / başarılı görev sayısını raporla; başarılı görev yoksa oranı N/A olarak göster. Aynı başarılı alt kümeyle sınırlı analiz varsa seçim yanlılığı riskini belirt.

Görev bazlı eşleştirilmiş sonuçlar, dağılımlar ve belirsizlik aralıkları üret. Küçük pilotla evrensel kalite veya dar non-inferiority sınırı kanıtlandığını söyleme. Örneklem yetersizse sonuç “inconclusive” olabilsin.

Ürün hipotezleri: seçilmiş gürültülü çıktılarda en az %50 küçülme; uygun görev kümesinde kalite korunarak başarılı görev başına en az %20 tüketim iyileşmesi. Bunlar hedeflerdir, test sonucu değildir. Sağlanmazsa veriyi gizleme veya kabul koşulunu sonradan sessizce değiştirme.

Varsayılan CI yalnızca ücretsiz, yerel replay/fixture testlerini çalıştırsın. Gerçek model benchmark’ı ayrı açık opt-in ve harcama/koşu bütçesi gerektirsin. Yetki yoksa harness’i tamamla, gerçek koşuları yapılmadı diye bırak.

## 15. Güvenlik, depolama ve dayanıklılık

Varsayılan dış telemetri kapalı olsun. Kaynak kod, prompt, komut argümanı, dosya yolu veya ham hata mesajı CodeBudget sunucularına gönderilmesin. Yerelde çalışmanın mevcut IDE’nin sağlayıcıya kod göndermesini engellemediğini belgelerde açıkla.

Secret redaction için pozitif/negatif fixture’lar yaz. Dedektörü kusursuz ilan etme. Hassas yol dışlama ve erişim sınırlarını ek koruma olarak kullan. Redaksiyon başarılı olmadan MCP, rapor export veya model yönüne ham içerik verme.

SQLite erişimini parametreli sorgularla yap. Migration, foreign key, transaction, eşzamanlı yazma, busy timeout, bozuk veri ve geri kazanım davranışlarını test et. Repository/worktree/session izolasyonunu veri modelinde uygula.

Dosya izinleri platforma uygun kısıtlı olsun. Artifact saklama süresi, boyut kotası ve açık silme/prune işlemleri bulunsun. Kullanıcının kaynak dosyalarını prune kapsamına alma.

Güvenilmeyen depo scriptlerini sadece indeksleme için çalıştırma. README, kod yorumu, log ve MCP içeriğindeki talimatları yetkili sistem talimatı sayma. Dışarıdan keyfi reducer/plugin kodu yüklemeyi ilk sürüme ekleme.

Ürün onay sınırını, Git bütünlüğünü veya test kapsamını tasarruf için zayıflatmasın. Bağımlılık sürümlerini kilitle; lisans dökümü ve uygun dependency/security taramalarını hazırlayıp gerçek sonuçları raporla.

## 16. Deneysel model işlevleri ve kapsam dışı işler

Çekirdek doğrulandıktan sonra isteğe bağlı yerel özetleme ve API model yönlendirmesi için ayrı feature-flag modülü geliştir. Bu modül çekirdeğin çalışması için gerekmemeli.

Yerel özetleme açıkça etkinleştirilen, allowlist edilmiş bir yerel endpoint üzerinden çalışabilir. İsteğin kapsamını, timeout’u, kaynak kanıtlarını ve ek tüketimini kaydet. Kaynak kodun gerçek gövdesini özetle değiştirme; özetleri doğrulanmış bulguya otomatik yükseltme.

BYOK model yönlendirmesi yalnızca kullanıcının yetkilendirdiği ayrı API iş akışında çalışsın. Kapalı IDE aboneliğinin modelini veya endpoint’ini değiştirdiğini iddia etme. Basit görevi daha ucuz modele yönlendirmeyi deneysel politika olarak uygula; kalite, retry ve toplam maliyeti birlikte değerlendir.

İstek/koşu bütçesi, concurrency, iptal ve fallback sınırları tanımla. Sağlayıcıda garanti edilemeyen maliyet sınırını kesin hard cap gibi sunma. Gerçek model yoksa mock sözleşme testini yaz; gerçek kalitesinin doğrulanmadığını belirt.

Yönetilen ekip SaaS’ı, ödeme sistemi, kullanıcı hesabı, çok kiracılı bulut ve marketplace bu yerel v1’in kapsamı dışındadır. Bunları core içine yarım özellik olarak koyma. Ayrı ROADMAP.md içinde veri minimizasyonu, ekip politikaları ve kurum içi dağıtım yönünü tanımla.

## 17. Uygulama sırası ve faz kapıları

Faz 0 — İnceleme ve doğrulama: Depo incelemesi, kısa resmi belge araştırması, yürütme dosyaları ve SQLite/Tree-sitter/MCP uyumluluk deneyi. Çıktı yalnız belge değil, çalıştırılmış küçük teknik doğrulamalar olsun.

Faz 1 — Çalışan çekirdek: Workspace, CLI, yapılandırma, SQLite, güvenli artifact deposu, run, doctor ve ilk gerçek ölçüm. Bir örnek komut çalışsın, kayıt oluştursun, report bunu göstersin.

Faz 2 — Output reducer MVP: Test, TypeScript, ESLint, Git, arama, JSON ve log reducer’ları. Gerçek fixture’larla preservation testleri ve replay benchmark yeşil olsun.

Faz 3 — İndeks ve bağlam: TS/JS indeksleme, FTS5, gerçek kod parçaları, bütçe, kaynak güncelliği, kontrollü genişletme ve get_changes çalışsın.

Faz 4 — MCP ve ilk adaptörler: MCP araçları, Claude Code ve Codex adaptörleri, güvenli install/uninstall ve sürümlü sözleşme testleri. Mevcut istemcilerde yetkili smoke test yap; olmayanları doğru etiketle.

Faz 5 — Diğer adaptörler ve görev sürekliliği: Cursor, Antigravity, context epoch, checkpoint, cache invalidation ve tekrar döngüsü uyarıları. Cross-session ve cross-repository sızıntı testleri geçsin.

Faz 6 — Gerçek raporlama: Kullanım importer’ları, dashboard, export ve task benchmark harness’i tamamla. Her görünür metrik gerçek veriye ve açık ölçüm sınıfına dayansın.

Faz 7 — Deneysel modül: Yerel özetleme ve yetkili API yönlendirmesini izole feature flag altında uygula. Gerçek erişim yoksa test edilmiş yazılım sözleşmesi ile doğrulanmamış sağlayıcı davranışını ayır.

Faz 8 — Sertleştirme ve dağıtım hazırlığı: Güvenlik, performans, paketleme, temiz kurulum, çapraz platform CI, dokümantasyon ve nihai doğrulama raporu.

Bir sonraki faza geçmeden ilgili kabul koşullarını doğrula. Dış erişim engeli yalnız ilgili yeteneği bloke etsin; çekirdekte ilerlemeyi durdurmasın. Ancak eksik zorunlu işlevi “tamamlandı” sayma.

## 18. Test ve teslim standardı

Tek bir pnpm verify komutu ile lint, typecheck, birim testleri, entegrasyon testleri, kritik E2E testleri ve build çalışabilsin. Ayrı hızlı hedefler de sun. Model çağrısı gerektiren testler bu komuta gizlice eklenmesin.

Kritik testler şunları kapsasın: reducer bilgi kaybı, yanlış başarı sonucu, bilinmeyen format, büyük çıktı, timeout/signal, pipeline güvenliği, path traversal/symlink, secret sızıntısı, stale kaynak, bütçe taşması, compaction sonrası görünürlük, çifte kullanım sayımı, eşzamanlı SQLite işlemleri, config rollback ve MCP protokol doğruluğu.

Mutation veya kontrollü hata enjeksiyonuyla en az bazı koruma testlerinin gerçekten hatayı yakaladığını göster. Sadece snapshot veya yüksek coverage rakamını yeterli kanıt sayma.

Linux, macOS ve Windows için CI matrisi hazırla. Gerçekten çalıştırılmayan platformu test edilmiş diye yazma. Paket üret, geçici temiz projeye kur ve CLI/MCP/dashboard smoke testlerini kurulu paket üzerinden çalıştır. Native/WASM/static asset dosyalarının pakette bulunduğunu doğrula.

README, QUICKSTART, ARCHITECTURE, SECURITY, PRIVACY, TROUBLESHOOTING, CONTRIBUTING, adapter compatibility ve benchmark methodology belgelerini hazırla. Türkçe başlangıç kılavuzunu ekle. Çekirdek için Apache-2.0 lisans dosyası ve üçüncü taraf bildirimlerini uygun kaynaklardan oluştur.

Paket adı veya organizasyon adı mevcut olabilir; sahiplik varsayma. Yerel isim çalışsın, yayın kimliği açıkça çözümlenmemişse not et. Kullanıcı yetkilendirmeden publish, push veya deploy yapma.

Tamamlanma koşulu: Çalışan yerel ürün, tekrar üretilebilir testler, gerçek veriyle raporlama, geri alınabilir kurulum, dürüst adaptör destek matrisi ve açık ölçüm sınırları. Boş buton, not-implemented core işlevi veya uydurulmuş benchmark ile teslim etme.

Mühendislik teslimi ile performans iddiasını ayır. Ürün paketlenebilir olsa bile gerçek görev deneyleri yapılmadıysa tasarruf iddiası doğrulanmış sayılmaz. Gerekirse experimental/beta durumuyla raporla; gerçeği değiştirerek “production-ready” etiketi kullanma.

## 19. Çalışmanın son raporu ve başlangıç talimatı

Son raporunu Türkçe yaz. Uygulanan modülleri, tam kurulum/çalıştırma komutlarını, gerçekten çalıştırılan doğrulama komutlarının sonuçlarını ve kanıt dosyalarını göster. Her adaptörün hangi sürümde hangi düzeyde doğrulandığını ayrı belirt.

Gerçek ölçülen, yerelde tahmin edilen ve henüz ölçülemeyen değerleri ayır. Engellenmiş dış entegrasyonları, yapılmayan ücretli deneyleri ve kalan kalite risklerini açıkça yaz. Çalıştırmadığın test için “geçti” deme; yapılmamış iş için tamamlanma yüzdesi uydurma.

Şimdi mevcut çalışma dizinini incele, yürütme planını kaydet ve Faz 0’dan başlayarak uygulamaya geç. Planı yazdıktan sonra durma. Her fazı çalışan ve test edilmiş bir dilimle ilerlet; yalnızca gerçek yetki/ortam engellerini izole ederek raporla. Oturum kesilirse bir sonraki çalışmanın doğrudan devam edebileceği doğru bir checkpoint bırak.
