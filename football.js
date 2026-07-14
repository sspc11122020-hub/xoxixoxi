import axios from 'axios';
import fs from 'fs';

/**
 * دالة لاستخراج الرابط المباشر m3u8 من المشغل
 */
async function getDirectStream(iframeUrl) {
    if (!iframeUrl) return "";
    
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    try {
        const { data } = await axios.get(fullIframeUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://liva7hd.info/', // تم التحديث ليطابق الموقع الجديد
                'Accept': '*/*'
            },
            timeout: 10000 
        });

        // 1. البحث عن روابط m3u8 الصريحة
        const m3u8Regex = /https?[:\/\w\.-]+\.m3u8[^\s"']*/gi;
        let matches = data.match(m3u8Regex);

        if (matches && matches.length > 0) {
            return matches[0].replace(/\\/g, ''); 
        }

        // 2. البحث عن الروابط داخل سمة "source" في المشغل
        const sourceRegex = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
        const sourceMatch = data.match(sourceRegex);
        if (sourceMatch) return sourceMatch[1];

        // 3. البحث عن روابط Base64 (إذا كان المشغل يشفر الرابط)
        const base64Regex = /["']([A-Za-z0-9+/]{50,})={0,2}["']/g;
        let b64Matches;
        while ((b64Matches = base64Regex.exec(data)) !== null) {
            try {
                let decoded = Buffer.from(b64Matches[1], 'base64').toString('utf-8');
                if (decoded.includes('.m3u8')) {
                    return decoded.match(/https?[:\/\w\.-]+\.m3u8[^\s"']*/i)[0];
                }
            } catch (e) {}
        }

        return "";
    } catch (e) {
        return "";
    }
}

/**
 * السكريبت الرئيسي للتعامل مع الـ API الجديد
 */
async function scrapeMatches() {
    try {
        console.log("🚀 جاري جلب المباريات من الـ API...");
        
        // الرابط الجديد
        const apiUrl = `https://liva7hd.info/wp-content/themes/jannah-1/MatchesPanel/api/matches.php?v=${Date.now()}`;
        
        const { data } = await axios.get(apiUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
            }
        });

        // الحصول على مصفوفة المباريات من الـ JSON
        const matchesData = data.matches || [];
        const formattedMatches = [];

        for (let i = 0; i < matchesData.length; i++) {
            const matchInfo = matchesData[i];
            
            // استخراج الأسماء من الكائنات المتداخلة في الـ API الجديد
            const team1Name = matchInfo.team1?.name || "";
            const team2Name = matchInfo.team2?.name || "";

            console.log(`🔍 جاري استخراج: ${team1Name} vs ${team2Name}`);

            // استخراج رابط البث من meta.link
            const streamUrl = matchInfo.meta?.link || "";

            // محاولة جلب رابط البث المباشر (m3u8)
            let directStream = "";
            if (streamUrl) {
                directStream = await getDirectStream(streamUrl);
            }

            if (directStream) {
                console.log(`✅ تم العثور على الرابط المباشر!`);
            } else {
                console.log(`❌ لم يتم العثور على رابط مباشر`);
            }

            // تحويل حالة المباراة
            let matchStatus = matchInfo.meta?.status || "";
            if (matchStatus && matchStatus.toLowerCase() === "live") {
                matchStatus = "جارية الآن";
            }

            // تجهيز الكائن بالشكل القديم تماماً للحفاظ على نفس هيكل الـ JSON الناتج
            const match = {
                id: i + 1,
                team1: team1Name,
                team1Logo: matchInfo.team1?.logo || "",
                team2: team2Name,
                team2Logo: matchInfo.team2?.logo || "",
                time: "", // تركت فارغة لأن الـ API الجديد لا يعرض وقت المباراة في هذا المستوى
                status: matchStatus,
                channel: matchInfo.meta?.channel || matchInfo.meta?.commentator || "", // أولوية للقناة ثم المعلق
                league: matchInfo.meta?.champ || "",
                streamUrl: streamUrl,
                stream: directStream
            };

            formattedMatches.push(match);
        }

        // حفظ البيانات في الملف
        fs.writeFileSync('matches.json', JSON.stringify(formattedMatches, null, 2), 'utf8');
        console.log("---");
        console.log(`✅ انتهى العمل. تم حفظ ${formattedMatches.length} مباراة في matches.json بنجاح.`);

    } catch (error) {
        console.error('❌ خطأ في السكربت الرئيسي:', error.message);
    }
}

scrapeMatches();
