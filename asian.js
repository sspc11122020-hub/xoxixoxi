import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// إعدادات المسارات المخصصة للدراما الآسيوية
const ASIAN_DIR = path.join(__dirname, "asian");
const HOME_FILE = path.join(ASIAN_DIR, "Home.json");

if (!fs.existsSync(ASIAN_DIR)) {
    fs.mkdirSync(ASIAN_DIR, { recursive: true });
}

const BASE_URL = "https://topcinemaa.com";

// ==================== دوال المساعدة ====================
async function fetchPage(url) {
    try {
        console.log(`🌐 [آسيوي] جاري جلب: ${url.substring(0, 60)}...`);
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
            'Referer': BASE_URL,
        };
        const response = await fetch(url, { headers });
        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        console.log(`❌ خطأ في الجلب: ${error.message}`);
        return null;
    }
}

function cleanText(text) {
    return text ? text.replace(/\s+/g, " ").trim() : "";
}

function extractId(url) {
    try {
        const match = url.match(/[?&]p=(\d+)/);
        if (match && match[1]) return match[1];
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        const lastPart = pathParts[pathParts.length - 1];
        const numMatch = lastPart.match(/(\d+)$/);
        return numMatch ? numMatch[1] : `temp_${Date.now()}`;
    } catch {
        return `temp_${Date.now()}`;
    }
}

function findM3u8InSource(htmlContent) {
    if (!htmlContent) return null;
    const m3u8Regex = /(https?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_\+.~#?&//=]*\.m3u8[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i;
    let match = htmlContent.match(m3u8Regex);
    if (match) return match[1].replace(/\\/g, ''); 

    const alternativeRegex = /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i;
    match = htmlContent.match(alternativeRegex);
    if (match) return match[1].replace(/\\/g, '');

    return null;
}

// ==================== استخراج سيرفرات المشاهدة والتحميل ====================
async function extractWatchServers(watchUrl) {
    try {
        const html = await fetchPage(watchUrl);
        if (!html) return [];
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        const metaTags = ['og:video:secure_url', 'og:video', 'twitter:player:stream', 'video'];
        metaTags.forEach(property => {
            const meta = doc.querySelector(`meta[property="${property}"]`) || doc.querySelector(`meta[name="${property}"]`);
            if (meta && meta.content) {
                servers.push({
                    name: "مشاهدة مباشرة",
                    url: meta.content,
                    quality: "متعدد الجودات",
                    type: "meta_stream",
                    m3u8Url: meta.content.includes('.m3u8') ? meta.content : null
                });
            }
        });
        
        const iframes = doc.querySelectorAll('iframe[src*="embed"], iframe[src*="video"], iframe[src*="player"], iframe[src*="vtt"], iframe[src*="ramp"]');
        for (let i = 0; i < iframes.length; i++) {
            let src = iframes[i].src;
            if (src) {
                if (src.startsWith('//')) src = 'https:' + src;
                let m3u8Url = src.includes('.m3u8') ? src : null;
                if (!m3u8Url) {
                    const serverHtml = await fetchPage(src);
                    m3u8Url = findM3u8InSource(serverHtml);
                }
                servers.push({
                    name: `سيرفر مشاهدة ${i + 1}`,
                    url: src,
                    quality: "متعدد الجودات",
                    type: "iframe",
                    m3u8Url: m3u8Url
                });
            }
        }
        
        const generalM3u8 = findM3u8InSource(html);
        if (generalM3u8 && servers.length > 0 && !servers[0].m3u8Url) {
            servers[0].m3u8Url = generalM3u8;
        } else if (generalM3u8 && servers.length === 0) {
            servers.push({
                name: "مشغل مدمج",
                url: watchUrl,
                quality: "تلقائي",
                type: "inline",
                m3u8Url: generalM3u8
            });
        }
        return servers;
    } catch {
        return [];
    }
}

async function extractDownloadServers(downloadUrl) {
    try {
        const html = await fetchPage(downloadUrl);
        if (!html) return [];
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const servers = [];
        
        const proServers = doc.querySelectorAll('.proServer a.downloadsLink');
        proServers.forEach(server => {
            const nameElement = server.querySelector('.text p');
            const qualityElement = server.querySelector('.text span');
            servers.push({
                name: cleanText(nameElement?.textContent) || "VidTube",
                url: server.href,
                quality: cleanText(qualityElement?.textContent) || "متعدد الجودات",
                type: "pro_server"
            });
        });
        
        const downloadBlocks = doc.querySelectorAll('.DownloadBlock');
        downloadBlocks.forEach(block => {
            const qualityElement = block.querySelector('.download-title span');
            const quality = qualityElement ? cleanText(qualityElement.textContent) : "1080p";
            const serverLinks = block.querySelectorAll('ul.download-items a.downloadsLink');
            serverLinks.forEach(link => {
                const nameElement = link.querySelector('.text p');
                servers.push({
                    name: cleanText(nameElement?.textContent) || quality,
                    url: link.href,
                    quality: quality,
                    type: "download_server"
                });
            });
        });
        return servers.filter((server, index, self) => index === self.findIndex((s) => s.url === server.url));
    } catch {
        return [];
    }
}

// ==================== استخراج التفاصيل الكاملة ====================
async function fetchDetails(item, position, total) {
    console.log(`\n🌏 [${position}/${total}] جاري تفاصيل: ${item.title}...`);
    try {
        const html = await fetchPage(item.url);
        if (!html) return null;
        
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        
        const shortLinkInput = doc.querySelector('input#shortlink');
        let shortLink = shortLinkInput ? shortLinkInput.value : item.url;
        const itemId = extractId(shortLink);
        
        const titleElement = doc.querySelector("h1.post-title a") || doc.querySelector(".post-title");
        const title = cleanText(titleElement?.textContent || item.title);
        let image = doc.querySelector(".image img")?.src || doc.querySelector("img[src*='MV5B']");
        const imdbRating = cleanText(doc.querySelector(".imdbR span, .imdbRating span")?.textContent) || null;
        const story = cleanText(doc.querySelector(".story p, .entry-content p")?.textContent) || "غير متوفر";
        
        const details = {};
        doc.querySelectorAll("ul.RightTaxContent li, .post-details li, .movie-details li").forEach(li => {
            const labelElement = li.querySelector("span, strong:first-child");
            if (labelElement) {
                let label = cleanText(labelElement.textContent).replace(":", "").trim();
                let value = cleanText(li.textContent.replace(labelElement.textContent, ""));
                const linkTexts = Array.from(li.querySelectorAll("a")).map(a => cleanText(a.textContent));
                
                if (label.includes('قسم') || label.includes('التصنيف')) details["قسم المسلسل"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('نوع')) details["نوع المسلسل"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('جودة')) details["جودة الحلقة"] = linkTexts.length > 0 ? linkTexts : [value];
                else if (label.includes('صدور') || label.includes('تاريخ')) details["موعد الصدور"] = linkTexts.length > 0 ? linkTexts : [value];
            }
        });

        const watchButton = doc.querySelector('a.watch, a[href*="/watch/"], .watch-btn a');
        const downloadButton = doc.querySelector('a.download, a[href*="/download/"], .download-btn a');
        
        let watchServers = watchButton ? await extractWatchServers(watchButton.href) : await extractWatchServers(item.url);
        let downloadServers = downloadButton ? await extractDownloadServers(downloadButton.href) : [];
        
        return {
            id: itemId,
            title: title,
            url: item.url,
            shortLink: shortLink,
            image: image || null,
            imdbRating: imdbRating,
            story: story,
            details: details,
            watchServers: watchServers,
            downloadServers: downloadServers,
            scrapedAt: new Date().toISOString()
        };
    } catch (error) {
        return null;
    }
}

// ==================== التشغيل ====================
async function startScraping() {
    console.log("🚀 بدء استخراج المسلسلات الآسيوية...");
    const url = `${BASE_URL}/category/مسلسلات-اسيوية/?key=episodes`;
    
    const html = await fetchPage(url);
    if (!html) return;
    
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const initialItems = [];
    
    doc.querySelectorAll('.Small--Box a.recent--block').forEach((element, i) => {
        let itemUrl = element.href;
        if (itemUrl) {
            if (itemUrl.startsWith('/')) itemUrl = BASE_URL + itemUrl;
            const title = cleanText(element.querySelector('h3.title')?.textContent || `مسلسل آسيوي ${i + 1}`);
            initialItems.push({ title, url: itemUrl });
        }
    });
    
    console.log(`✅ تم العثور على ${initialItems.length} حلقة في الصفحة الأولى.`);
    const finalList = [];
    
    for (let i = 0; i < initialItems.length; i++) {
        const res = await fetchDetails(initialItems[i], i + 1, initialItems.length);
        if (res) finalList.push(res);
        await new Promise(r => setTimeout(r, 1000));
    }
    
    fs.writeFileSync(HOME_FILE, JSON.stringify({
        fileName: "Home.json",
        description: "مسلسلات آسيوية الصفحة الأولى حية من الشبكة",
        totalSeries: finalList.length,
        lastUpdated: new Date().toISOString(),
        series: finalList
    }, null, 2));
    console.log(`\n🏠 اكتمل الحفظ بنجاح في: ${HOME_FILE}`);
}

startScraping();
