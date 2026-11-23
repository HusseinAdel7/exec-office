// =========================================================
//  الإرسال التلقائي على واتساب (WhatsApp Cloud API الرسمي من Meta)
//  - الإعدادات في جدول Settings (المفتاح whatsapp)، والتوكن متشفّر بـ Data Protection
//  - كل رسالة بتتسجل في WaLog، ومفتاح كل رسالة بيمنع تكرارها
//  - TickAsync بتشتغل كل دقيقة: ملخص الصبح، التذكير قبل المواعيد، طلبات الموافقة، العاجل والمتأخر
// =========================================================
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;

public sealed class WaSettings
{
    public bool Enabled { get; set; }
    public string? PhoneNumberId { get; set; }
    public string? TokenEnc { get; set; }
    public string ApiVersion { get; set; } = "v21.0";
    public string? Template { get; set; } = "office_notice";
    public string Lang { get; set; } = "ar";
    public string? DirectorPhone { get; set; }
    public string? SecretaryPhone { get; set; }
    public string BriefTime { get; set; } = "08:00";
    public int LeadMinutes { get; set; } = 60;
    public Dictionary<string, string> To { get; set; } = DefaultTo();
    public DateTime? EnabledAt { get; set; }

    public static Dictionary<string, string> DefaultTo() => new()
    {
        ["brief"] = "director", ["reminders"] = "both", ["approvals"] = "director", ["decisions"] = "secretary", ["urgent"] = "both", ["alerts"] = "secretary",
    };
}

public sealed class WaService
{
    static readonly JsonSerializerOptions J = new(JsonSerializerDefaults.Web);
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(25) };
    static readonly CultureInfo Ar = new("ar-EG");
    public static readonly string[] Kinds = ["brief", "reminders", "approvals", "decisions", "urgent", "alerts"];
    public static readonly string[] Targets = ["off", "director", "secretary", "both"];

    static readonly Dictionary<string, string[]> Done = new()
    {
        ["meetings"] = ["تم", "ملغى"], ["cases"] = ["صدر الحكم", "مشطوبة", "منتهية"], ["travel"] = ["عاد", "ملغاة"],
        ["contracts"] = ["منتهي", "ملغى"], ["approvals"] = ["تمت الموافقة", "مرفوض"], ["tasks"] = ["منجزة", "ملغاة"],
        ["calls"] = ["تم الرد", "لا تحتاج رداً"], ["finance"] = ["مدفوع"], ["contacts"] = [],
    };
    static readonly Dictionary<string, string> DateF = new() { ["meetings"] = "date", ["cases"] = "nextHearing", ["travel"] = "departDate", ["contracts"] = "endDate", ["approvals"] = "dueDate", ["tasks"] = "dueDate", ["calls"] = "date" };
    static readonly Dictionary<string, string> TimeF = new() { ["meetings"] = "time", ["cases"] = "hearingTime", ["tasks"] = "time", ["calls"] = "time" };
    static readonly Dictionary<string, string> One = new() { ["meetings"] = "موعد", ["cases"] = "جلسة", ["travel"] = "سفر", ["contracts"] = "عقد", ["approvals"] = "طلب موافقة", ["tasks"] = "مهمة", ["calls"] = "مكالمة" };

    readonly string _cs;
    readonly ILogger _log;
    readonly IDataProtector _prot;
    readonly SemaphoreSlim _tickLock = new(1, 1);

    public WaService(string cs, ILogger log, IDataProtector prot) { _cs = cs; _log = log; _prot = prot; }

    // ---------------- settings ----------------
    public async Task<WaSettings> LoadAsync()
    {
        await using var c = await Db.OpenAsync(_cs);
        var v = (string?)await Db.ScalarAsync(c, "SELECT Value FROM dbo.Settings WHERE [Key]=N'whatsapp'");
        WaSettings s;
        try { s = string.IsNullOrEmpty(v) ? new() : JsonSerializer.Deserialize<WaSettings>(v, J) ?? new(); } catch { s = new(); }
        foreach (var k in Kinds) if (!s.To.ContainsKey(k)) s.To[k] = WaSettings.DefaultTo()[k];
        return s;
    }
    public async Task SaveAsync(WaSettings s)
    {
        await using var c = await Db.OpenAsync(_cs);
        await Db.ExecAsync(c, @"MERGE dbo.Settings AS t USING (SELECT N'whatsapp' AS [Key]) AS x ON t.[Key]=x.[Key]
WHEN MATCHED THEN UPDATE SET Value=@v, Updated=SYSUTCDATETIME() WHEN NOT MATCHED THEN INSERT([Key], Value) VALUES(N'whatsapp', @v);", ("@v", JsonSerializer.Serialize(s, J)));
    }
    public object Public(WaSettings s) => new
    {
        s.Enabled, s.PhoneNumberId, tokenSet = Token(s) is not null, s.ApiVersion, s.Template, s.Lang,
        s.DirectorPhone, s.SecretaryPhone, s.BriefTime, s.LeadMinutes, s.To, s.EnabledAt,
    };
    public void SetToken(WaSettings s, string? token) => s.TokenEnc = string.IsNullOrWhiteSpace(token) ? null : _prot.Protect(token.Trim());
    string? Token(WaSettings s)
    {
        if (string.IsNullOrEmpty(s.TokenEnc)) return null;
        try { return _prot.Unprotect(s.TokenEnc); } catch { return null; }
    }

    public static string? NormPhone(string? p)
    {
        if (string.IsNullOrWhiteSpace(p)) return null;
        var d = new string(p.Where(char.IsAsciiDigit).ToArray());
        if (d.StartsWith("00")) d = d[2..];
        if (d.Length == 11 && d.StartsWith("01")) d = "2" + d; // رقم مصري محلي 01xxxxxxxxx
        return d.Length >= 8 ? d : null;
    }
    List<string> Recipients(WaSettings s, string kind)
    {
        var to = s.To.GetValueOrDefault(kind, "off");
        var list = new List<string>();
        if (to is "director" or "both" && NormPhone(s.DirectorPhone) is string a) list.Add(a);
        if (to is "secretary" or "both" && NormPhone(s.SecretaryPhone) is string b && !list.Contains(b)) list.Add(b);
        return list;
    }

    // ---------------- sending ----------------
    public async Task<(bool ok, string? error)> SendAsync(WaSettings s, string phone, IReadOnlyList<string> lines, string key, string kind)
    {
        var token = Token(s);
        string? err = null, msgId = null;
        var useTemplate = !string.IsNullOrWhiteSpace(s.Template);
        var text = useTemplate ? OneLine(string.Join(" • ", lines), 900) : Cut(string.Join("\n", lines), 3800);
        if (token is null || string.IsNullOrWhiteSpace(s.PhoneNumberId)) err = "إعدادات واتساب غير مكتملة (معرّف الرقم أو التوكن)";
        else
        {
            object payload = useTemplate
                ? new
                {
                    messaging_product = "whatsapp", to = phone, type = "template",
                    template = new { name = s.Template!.Trim(), language = new { code = string.IsNullOrWhiteSpace(s.Lang) ? "ar" : s.Lang.Trim() }, components = new object[] { new { type = "body", parameters = new object[] { new { type = "text", text } } } } },
                }
                : new { messaging_product = "whatsapp", to = phone, type = "text", text = new { body = text, preview_url = false } };
            try
            {
                var ver = string.IsNullOrWhiteSpace(s.ApiVersion) ? "v21.0" : s.ApiVersion.Trim();
                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{Uri.EscapeDataString(ver)}/{Uri.EscapeDataString(s.PhoneNumberId!.Trim())}/messages")
                {
                    Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                };
                req.Headers.Authorization = new("Bearer", token);
                using var res = await Http.SendAsync(req);
                var body = await res.Content.ReadAsStringAsync();
                JsonNode? j = null;
                try { j = JsonNode.Parse(body); } catch { }
                if (res.IsSuccessStatusCode) msgId = j?["messages"]?[0]?["id"]?.ToString();
                else err = (j?["error"]?["error_user_msg"] ?? j?["error"]?["message"])?.ToString() ?? $"HTTP {(int)res.StatusCode}";
            }
            catch (Exception ex) { err = ex.Message; }
        }
        await using var c = await Db.OpenAsync(_cs);
        await Db.ExecAsync(c, "INSERT dbo.WaLog([Key], Kind, ToPhone, Body, Ok, Error, MsgId) VALUES(@k,@kind,@to,@b,@ok,@e,@m)",
            ("@k", Cut(key, 300)), ("@kind", kind), ("@to", phone), ("@b", text), ("@ok", err is null), ("@e", err), ("@m", msgId));
        if (err is not null) _log.LogWarning("WhatsApp send failed ({Kind} → {To}): {Err}", kind, phone, err);
        return (err is null, err);
    }

    // بتبعت لكل المستلمين بتوع النوع ده، مرة واحدة بس لكل مفتاح (وبتحاول 3 مرات بالكتير لو فشلت)
    async Task SendOnceAsync(SqlConnection c, WaSettings s, string kind, string key, Func<List<string>> build)
    {
        List<string>? lines = null;
        foreach (var phone in Recipients(s, kind))
        {
            var k = key + "|" + phone;
            await using (var cmd = new SqlCommand("SELECT SUM(CASE WHEN Ok=1 THEN 1 ELSE 0 END), COUNT(*) FROM dbo.WaLog WHERE [Key]=@k", c))
            {
                cmd.Parameters.AddWithValue("@k", Cut(k, 300));
                await using var r = await cmd.ExecuteReaderAsync();
                await r.ReadAsync();
                var okCount = r.IsDBNull(0) ? 0 : r.GetInt32(0);
                if (okCount > 0 || r.GetInt32(1) >= 3) continue;
            }
            lines ??= build();
            if (lines.Count == 0) return;
            await SendAsync(s, phone, lines, k, kind);
        }
    }

    // ---------------- data ----------------
    sealed record It(string Mod, string Id, JsonObject D, DateTime Created, DateTime Updated)
    {
        public string S(string k) { try { return D[k] is JsonValue v ? (v.TryGetValue<string>(out var x) ? x : v.ToString()) : ""; } catch { return ""; } }
        public bool IsDone => Done.TryGetValue(Mod, out var d) && d.Contains(S("status"));
        public string Date => DateF.TryGetValue(Mod, out var f) ? S(f) : "";
        public string Time => TimeF.TryGetValue(Mod, out var f) ? S(f) : "";
        public string Title => Mod switch { "calls" => S("caller"), "travel" => S("destination"), "contacts" => S("name"), _ => S("title") };
        public bool Urgent => S("priority") == "urgent";
    }
    async Task<(List<It> items, Dictionary<string, string> companies)> DataAsync(SqlConnection c)
    {
        var items = new List<It>();
        await using (var cmd = new SqlCommand("SELECT Module, Id, Data, Created, Updated FROM dbo.Items WHERE Deleted=0 AND Module IN (N'meetings',N'cases',N'travel',N'contracts',N'approvals',N'tasks',N'calls')", c))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync())
            {
                try { if (JsonNode.Parse(r.GetString(2)) is JsonObject o) items.Add(new It(r.GetString(0), r.GetString(1), o, DateTime.SpecifyKind(r.GetDateTime(3), DateTimeKind.Utc), DateTime.SpecifyKind(r.GetDateTime(4), DateTimeKind.Utc))); }
                catch { /* عنصر تالف */ }
            }
        var cos = new Dictionary<string, string>();
        await using (var cmd = new SqlCommand("SELECT Id, Name FROM dbo.Companies", c))
        await using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync()) cos[r.GetString(0)] = r.GetString(1);
        return (items, cos);
    }

    static string T12(string hm)
    {
        if (!TimeSpan.TryParse(hm, out var t)) return hm;
        var h = t.Hours % 12 == 0 ? 12 : t.Hours % 12;
        return $"{h}:{t.Minutes:00} {(t.Hours < 12 ? "ص" : "م")}";
    }
    static string Day(string ymd) => DateTime.TryParse(ymd, out var d) ? d.ToString("dddd d MMMM", Ar) : ymd;
    static string Money(string v) => decimal.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out var m) && m > 0 ? m.ToString("#,0", CultureInfo.InvariantCulture) + " ج.م" : "";
    static string OneLine(string s, int n) => Cut(System.Text.RegularExpressions.Regex.Replace(s.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' '), " {2,}", " ").Trim(), n);
    static string Cut(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + "…";
    static string Join(IEnumerable<string> parts, int max)
    {
        var l = parts.ToList();
        return string.Join("، ", l.Take(max)) + (l.Count > max ? $" و{l.Count - max} أخرى" : "");
    }

    // ---------------- messages ----------------
    List<string> BriefLines(List<It> items, Dictionary<string, string> cos, string today)
    {
        string Co(It i) => cos.GetValueOrDefault(i.S("company"), "");
        var open = items.Where(i => !i.IsDone).ToList();
        var sched = open.Where(i => i.Date == today && i.Mod is "meetings" or "cases" or "travel").OrderBy(i => string.IsNullOrEmpty(i.Time) ? "99" : i.Time).ToList();
        var appr = open.Where(i => i.Mod == "approvals").OrderBy(i => i.Date == "" ? "9" : i.Date).ToList();
        var late = open.Where(i => i.Mod is "tasks" or "cases" or "meetings" or "approvals" && i.Date != "" && string.CompareOrdinal(i.Date, today) < 0).ToList();
        var calls = open.Where(i => i.Mod == "calls" && i.S("status") == "بانتظار الرد").ToList();
        var lines = new List<string> { $"ملخص يوم {Day(today)}" };
        lines.Add(sched.Count == 0 ? "لا توجد مواعيد اليوم." : $"مواعيد اليوم ({sched.Count}): " + Join(sched.Select(i =>
            (i.Time != "" ? T12(i.Time) + " " : "") + (i.Mod == "travel" ? "سفر إلى " : i.Mod == "cases" ? "جلسة " : "") + i.Title + (Co(i) != "" ? $" ({Co(i)})" : "")), 6));
        if (appr.Count > 0) lines.Add($"بانتظار قرارك ({appr.Count}): " + Join(appr.Select(i => i.Title + (Money(i.S("amount")) is var m && m != "" ? $" بمبلغ {m}" : "")), 4));
        if (late.Count > 0) lines.Add($"متأخر ({late.Count}): " + Join(late.Select(i => i.Title), 4));
        if (calls.Count > 0) lines.Add($"مكالمات تنتظر الرد ({calls.Count}): " + Join(calls.Select(i => i.Title), 4));
        return lines;
    }
    static string Where(It i) => i.Mod switch
    {
        "cases" => i.S("court"),
        "meetings" => string.Join(" — ", new[] { i.S("location"), i.S("with") != "" ? "مع " + i.S("with") : "" }.Where(x => x != "")),
        _ => "",
    };

    // ---------------- the scheduler tick ----------------
    public async Task TickAsync()
    {
        if (!await _tickLock.WaitAsync(0)) return;
        try
        {
            var s = await LoadAsync();
            if (!s.Enabled || Token(s) is null || string.IsNullOrWhiteSpace(s.PhoneNumberId)) return;
            var since = s.EnabledAt ?? DateTime.UtcNow;
            var now = DateTime.Now;
            var today = now.ToString("yyyy-MM-dd");
            var hm = now.ToString("HH:mm");
            await using var c = await Db.OpenAsync(_cs);
            var (items, cos) = await DataAsync(c);
            string Co(It i) => cos.GetValueOrDefault(i.S("company"), "");
            var morning = string.CompareOrdinal(hm, s.BriefTime) >= 0;

            // 1) ملخص الصبح
            if (morning) await SendOnceAsync(c, s, "brief", "brief:" + today, () => BriefLines(items, cos, today));

            // 2) التذكير قبل المواعيد والجلسات والمهام اللي ليها ساعة
            foreach (var i in items.Where(i => !i.IsDone && i.Mod is "meetings" or "cases" or "tasks" && i.Date == today && i.Time != ""))
            {
                if (!TimeSpan.TryParse(i.Time, out var at)) continue;
                var mins = (at - now.TimeOfDay).TotalMinutes;
                if (mins < 0 || mins > s.LeadMinutes) continue;
                await SendOnceAsync(c, s, "reminders", $"rem:{i.Mod}:{i.Id}:{i.Date}T{i.Time}", () => new()
                {
                    $"تذكير: {One[i.Mod]} «{i.Title}» اليوم الساعة {T12(i.Time)} (بعد {Math.Max(1, (int)Math.Round(mins))} دقيقة)",
                    string.Join(" — ", new[] { Where(i), Co(i) }.Where(x => x != "")),
                });
            }

            // 3) طلب موافقة جديد → المدير، وقرار المدير → السكرتارية
            foreach (var i in items.Where(i => i.Mod == "approvals"))
            {
                var st = i.S("status");
                if (!i.IsDone && st != "يحتاج تعديلاً" && i.Created >= since)
                    await SendOnceAsync(c, s, "approvals", $"appr:{i.Id}", () => new()
                    {
                        $"طلب موافقة جديد: «{i.Title}»",
                        string.Join(" — ", new[] { i.S("requestedBy") != "" ? "مقدَّم من " + i.S("requestedBy") : "", Money(i.S("amount")) is var m && m != "" ? "المبلغ " + m : "", i.Date != "" ? "مطلوب قبل " + Day(i.Date) : "", Co(i) }.Where(x => x != "")),
                        "يمكن الرد عليه من صفحة المدير في النظام.",
                    });
                if (st is "تمت الموافقة" or "مرفوض" or "يحتاج تعديلاً" && i.Updated >= since && i.S("decisionAt") != "")
                    await SendOnceAsync(c, s, "decisions", $"dec:{i.Id}:{st}:{i.S("decisionAt")}", () => new List<string>
                    {
                        $"قرار المدير على «{i.Title}»: {st}",
                        i.S("decisionNote") != "" ? "التعليق: " + i.S("decisionNote") : "",
                        Co(i),
                    }.Where(x => x != "").ToList());
            }

            // 4) أي عنصر يتعلّم عاجل
            foreach (var i in items.Where(i => i.Urgent && !i.IsDone && i.Updated >= since && i.Mod != "approvals"))
                await SendOnceAsync(c, s, "urgent", $"urgent:{i.Mod}:{i.Id}", () => new()
                {
                    $"تنبيه عاجل: {One.GetValueOrDefault(i.Mod, "")} «{i.Title}»",
                    string.Join(" — ", new[] { i.Date != "" ? Day(i.Date) + (i.Time != "" ? " الساعة " + T12(i.Time) : "") : "", Where(i), Co(i) }.Where(x => x != "")),
                });

            // 5) ملخص المتأخرات والعقود القريبة من الانتهاء (مرة في اليوم مع وقت الملخص)
            if (morning)
                await SendOnceAsync(c, s, "alerts", "alerts:" + today, () =>
                {
                    var late = items.Where(i => !i.IsDone && i.Mod is "tasks" or "cases" or "meetings" or "approvals" or "calls" && i.Date != "" && string.CompareOrdinal(i.Date, today) < 0).OrderBy(i => i.Date).ToList();
                    var ending = items.Where(i => i.Mod == "contracts" && !i.IsDone && DateTime.TryParse(i.Date, out var e) && (e - now.Date).TotalDays <= RemindDays(i) && (e - now.Date).TotalDays >= -1).OrderBy(i => i.Date).ToList();
                    if (late.Count == 0 && ending.Count == 0) return new();
                    var l = new List<string> { "تنبيه المتأخرات والعقود" };
                    if (late.Count > 0) l.Add($"متأخر ({late.Count}): " + Join(late.Select(i => $"{i.Title} ({Day(i.Date)})"), 6));
                    if (ending.Count > 0) l.Add($"عقود قريبة الانتهاء ({ending.Count}): " + Join(ending.Select(i => $"{i.Title} ينتهي {Day(i.Date)}"), 5));
                    return l;
                });
        }
        catch (Exception ex) { _log.LogWarning("WhatsApp tick failed: {Msg}", ex.Message); }
        finally { _tickLock.Release(); }
    }
    static int RemindDays(It i) => int.TryParse(new string(i.S("remindDays").Where(char.IsAsciiDigit).ToArray()), out var n) && n > 0 ? n : 30;

    public async Task<(bool ok, string? error)> SendBriefNowAsync(WaSettings s)
    {
        await using var c = await Db.OpenAsync(_cs);
        var (items, cos) = await DataAsync(c);
        var phones = Recipients(s, "brief");
        if (phones.Count == 0) return (false, "لا يوجد رقم مستلم لملخص اليوم");
        (bool, string?) last = (true, null);
        foreach (var p in phones) last = await SendAsync(s, p, BriefLines(items, cos, DateTime.Now.ToString("yyyy-MM-dd")), "brief-manual:" + DateTime.UtcNow.Ticks + "|" + p, "brief");
        return last;
    }

    public async Task<List<object>> LogAsync(int n)
    {
        await using var c = await Db.OpenAsync(_cs);
        await using var cmd = new SqlCommand($"SELECT TOP ({Math.Clamp(n, 1, 200)}) At, Kind, ToPhone, Ok, Error, Body FROM dbo.WaLog ORDER BY Id DESC", c);
        await using var r = await cmd.ExecuteReaderAsync();
        var list = new List<object>();
        while (await r.ReadAsync())
            list.Add(new { at = DateTime.SpecifyKind(r.GetDateTime(0), DateTimeKind.Utc), kind = r.GetString(1), to = r.IsDBNull(2) ? null : r.GetString(2), ok = r.GetBoolean(3), error = r.IsDBNull(4) ? null : r.GetString(4), body = r.IsDBNull(5) ? null : r.GetString(5) });
        return list;
    }
}
