// =========================================================
//  مكتب المدير — API بيربط الموقع بقاعدة SQL Server
//  - بيقدّم الموقع نفسه (index.html / app.js / styles.css) على نفس العنوان
//  - تسجيل دخول بالكوكيز، وكلمات السر PBKDF2-SHA256
//  - كل الأقسام في جدول Items، والمرفقات في Attachments، والملفات في Files
// =========================================================
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.SqlClient;

var builder = WebApplication.CreateBuilder(args);
const long MaxUpload = 60L * 1024 * 1024;
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = MaxUpload);
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = MaxUpload);
builder.Services.AddDataProtection().SetApplicationName("ExecOffice");
var app = builder.Build();

var cs = app.Configuration.GetConnectionString("Db") ?? throw new InvalidOperationException("ConnectionStrings:Db is missing");
var siteRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, app.Configuration["SiteRoot"] ?? ".."));
// لو SQL Server لسه بيقوم (بعد تشغيل الجهاز مثلاً) نستنى بدل ما السيرفر يقع
for (var attempt = 1; ; attempt++)
{
    try
    {
        await Db.EnsureSchemaAsync(cs, Path.Combine(app.Environment.ContentRootPath, "schema.sql"));
        break;
    }
    catch (SqlException ex) when (attempt < 40)
    {
        app.Logger.LogWarning("SQL Server not reachable yet (attempt {Attempt}/40): {Message} — retrying in 3s", attempt, ex.Message);
        await Task.Delay(3000);
    }
}
app.Logger.LogInformation("Site folder: {Root}", siteRoot);

// ---------- الموقع نفسه (ملفات محددة بس) ----------
var siteFiles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    ["/index.html"] = "text/html; charset=utf-8",
    ["/app.js"] = "text/javascript; charset=utf-8",
    ["/styles.css"] = "text/css; charset=utf-8",
};
app.Use(async (ctx, next) =>
{
    var p = ctx.Request.Path.Value ?? "/";
    if (p == "/") p = "/index.html";
    if (HttpMethods.IsGet(ctx.Request.Method) && siteFiles.TryGetValue(p, out var type))
    {
        var f = Path.Combine(siteRoot, p.TrimStart('/'));
        if (File.Exists(f))
        {
            ctx.Response.ContentType = type;
            ctx.Response.Headers.CacheControl = "no-cache";
            await ctx.Response.SendFileAsync(f);
            return;
        }
    }
    await next();
});

// ---------- التحقق من الدخول لكل /api ما عدا /api/auth ----------
app.Use(async (ctx, next) =>
{
    var p = ctx.Request.Path.Value ?? "";
    if (!p.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) || p.StartsWith("/api/auth/", StringComparison.OrdinalIgnoreCase))
    {
        await next();
        return;
    }
    var user = await Auth.FromRequestAsync(cs, ctx);
    if (user is null)
    {
        ctx.Response.StatusCode = 401;
        await ctx.Response.WriteAsJsonAsync(new { error = "unauthorized" });
        return;
    }
    ctx.Items["user"] = user;
    await next();
});
static AppUser Me(HttpContext ctx) => (AppUser)ctx.Items["user"]!;
static IResult Forbidden() => Results.Json(new { error = "forbidden" }, statusCode: 403);
static IResult Bad(string msg) => Results.Json(new { error = msg }, statusCode: 400);

// ---------- auth ----------
app.MapGet("/api/auth/status", async (HttpContext ctx) =>
{
    await using var c = await Db.OpenAsync(cs);
    var hasUsers = (int)(await Db.ScalarAsync(c, "SELECT COUNT(*) FROM dbo.Users") ?? 0) > 0;
    var user = await Auth.FromRequestAsync(cs, ctx);
    return Results.Json(new { hasUsers, user });
});

app.MapPost("/api/auth/setup", async (HttpContext ctx, LoginBody b) =>
{
    await using var c = await Db.OpenAsync(cs);
    if ((int)(await Db.ScalarAsync(c, "SELECT COUNT(*) FROM dbo.Users") ?? 0) > 0) return Forbidden();
    var err = Auth.Validate(b.Username, b.Password);
    if (err is not null) return Bad(err);
    var id = await Auth.CreateUserAsync(c, b.Username!, string.IsNullOrWhiteSpace(b.DisplayName) ? b.Username! : b.DisplayName!, b.Password!, "admin");
    var user = new AppUser(id, b.Username!.Trim(), string.IsNullOrWhiteSpace(b.DisplayName) ? b.Username!.Trim() : b.DisplayName!.Trim(), "admin");
    await Auth.StartSessionAsync(c, ctx, id);
    return Results.Json(new { user });
});

app.MapPost("/api/auth/login", async (HttpContext ctx, LoginBody b) =>
{
    await using var c = await Db.OpenAsync(cs);
    var user = await Auth.CheckAsync(c, b.Username ?? "", b.Password ?? "");
    if (user is null)
    {
        await Task.Delay(700); // تبطيء محاولات التخمين
        return Results.Json(new { error = "wrong" }, statusCode: 401);
    }
    await Auth.StartSessionAsync(c, ctx, user.Id);
    return Results.Json(new { user });
});

app.MapPost("/api/auth/logout", async (HttpContext ctx) =>
{
    if (ctx.Request.Cookies.TryGetValue(Auth.Cookie, out var token))
    {
        await using var c = await Db.OpenAsync(cs);
        await Db.ExecAsync(c, "DELETE FROM dbo.Sessions WHERE Token=@t", ("@t", token));
    }
    ctx.Response.Cookies.Delete(Auth.Cookie);
    return Results.Json(new { ok = true });
});

app.MapPost("/api/me/password", async (HttpContext ctx, PasswordBody b) =>
{
    var me = Me(ctx);
    await using var c = await Db.OpenAsync(cs);
    if (await Auth.CheckAsync(c, me.Username, b.Current ?? "") is null) return Bad("كلمة السر الحالية غير صحيحة");
    var err = Auth.Validate(me.Username, b.Next);
    if (err is not null) return Bad(err);
    await Auth.SetPasswordAsync(c, me.Id, b.Next!);
    return Results.Json(new { ok = true });
});

// ---------- users (admin) ----------
app.MapGet("/api/users", async (HttpContext ctx) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    await using var c = await Db.OpenAsync(cs);
    var list = new List<object>();
    await using var cmd = new SqlCommand("SELECT Id, Username, DisplayName, Role, Created FROM dbo.Users ORDER BY Id", c);
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync()) list.Add(new { id = r.GetInt32(0), username = r.GetString(1), displayName = r.GetString(2), role = r.GetString(3), created = r.GetDateTime(4) });
    return Results.Json(list);
});
app.MapPost("/api/users", async (HttpContext ctx, LoginBody b) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    var err = Auth.Validate(b.Username, b.Password);
    if (err is not null) return Bad(err);
    await using var c = await Db.OpenAsync(cs);
    if ((int)(await Db.ScalarAsync(c, "SELECT COUNT(*) FROM dbo.Users WHERE Username=@u", ("@u", b.Username!.Trim())) ?? 0) > 0) return Bad("اسم المستخدم موجود بالفعل");
    var role = b.Role is "admin" or "director" ? b.Role : "user";
    var id = await Auth.CreateUserAsync(c, b.Username!, string.IsNullOrWhiteSpace(b.DisplayName) ? b.Username! : b.DisplayName!, b.Password!, role);
    return Results.Json(new { id });
});
app.MapDelete("/api/users/{id:int}", async (HttpContext ctx, int id) =>
{
    var me = Me(ctx);
    if (me.Role != "admin") return Forbidden();
    if (id == me.Id) return Bad("لا يمكنك حذف حسابك أثناء تسجيل الدخول به");
    await using var c = await Db.OpenAsync(cs);
    await Db.ExecAsync(c, "DELETE FROM dbo.Users WHERE Id=@id", ("@id", id));
    return Results.Json(new { ok = true });
});
app.MapPost("/api/users/{id:int}/password", async (HttpContext ctx, int id, PasswordBody b) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    if (string.IsNullOrEmpty(b.Next) || b.Next.Length < 6) return Bad("كلمة السر لازم تكون 6 حروف على الأقل");
    await using var c = await Db.OpenAsync(cs);
    await Auth.SetPasswordAsync(c, id, b.Next);
    await Db.ExecAsync(c, "DELETE FROM dbo.Sessions WHERE UserId=@id", ("@id", id));
    return Results.Json(new { ok = true });
});

// ---------- data ----------
app.MapGet("/api/data", async () =>
{
    await using var c = await Db.OpenAsync(cs);
    var now = await Db.NowAsync(c);
    var items = new Dictionary<string, List<JsonNode?>>();
    foreach (var m in Db.Modules) items[m] = new();
    foreach (var row in await Db.ItemRowsAsync(c, null)) items[row.Module].Add(row.Doc);
    return Results.Json(new { serverTime = now, companies = await Db.CompaniesAsync(c), items, attachments = (await Db.AttachmentRowsAsync(c, null)).Select(a => a.Doc) });
});

app.MapGet("/api/changes", async (string since) =>
{
    if (!DateTime.TryParse(since, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var s)) return Bad("since");
    await using var c = await Db.OpenAsync(cs);
    var now = await Db.NowAsync(c);
    var compChanged = await Db.ScalarAsync(c, "SELECT MAX(Updated) FROM dbo.Companies") is DateTime cu && cu >= s;
    return Results.Json(new
    {
        serverTime = now,
        companies = compChanged ? await Db.CompaniesAsync(c) : null,
        items = (await Db.ItemRowsAsync(c, s)).Select(r => new { mod = r.Module, id = r.Id, deleted = r.Deleted, doc = r.Deleted ? null : r.Doc }),
        attachments = (await Db.AttachmentRowsAsync(c, s)).Select(r => new { id = r.Id, deleted = r.Deleted, doc = r.Deleted ? null : r.Doc }),
    });
});

app.MapPut("/api/companies", async (HttpContext ctx, JsonObject body) =>
{
    if (body["companies"] is not JsonArray arr) return Bad("companies");
    await using var c = await Db.OpenAsync(cs);
    await Db.ReplaceCompaniesAsync(c, null, arr);
    return Results.Json(new { ok = true });
});

app.MapPut("/api/items/{mod}/{id}", async (HttpContext ctx, string mod, string id, JsonObject doc) =>
{
    if (!Db.Modules.Contains(mod)) return Bad("module");
    doc["id"] = id;
    await using var c = await Db.OpenAsync(cs);
    await Db.UpsertItemAsync(c, null, mod, id, doc, Me(ctx).Username);
    return Results.Json(new { ok = true });
});

app.MapDelete("/api/items/{mod}/{id}", async (HttpContext ctx, string mod, string id) =>
{
    if (!Db.Modules.Contains(mod)) return Bad("module");
    await using var c = await Db.OpenAsync(cs);
    await Db.ExecAsync(c, @"INSERT dbo.Activity(Username, Action, Module, ItemId, Title, CompanyId) SELECT @by, N'delete', Module, Id, Title, CompanyId FROM dbo.Items WHERE Module=@m AND Id=@id AND Deleted=0;
UPDATE dbo.Items SET Deleted=1, Updated=SYSUTCDATETIME(), UpdatedBy=@by WHERE Module=@m AND Id=@id", ("@m", mod), ("@id", id), ("@by", Me(ctx).Username));
    return Results.Json(new { ok = true });
});

// استيراد نسخة احتياطية كاملة (بيستبدل الشركات وكل العناصر)
app.MapPost("/api/import", async (HttpContext ctx, JsonObject body) =>
{
    await using var c = await Db.OpenAsync(cs);
    await using var tx = (SqlTransaction)await c.BeginTransactionAsync();
    if (body["companies"] is JsonArray comps) await Db.ReplaceCompaniesAsync(c, tx, comps);
    await Db.ExecAsync(c, "UPDATE dbo.Items SET Deleted=1, Updated=SYSUTCDATETIME() WHERE Deleted=0", tx);
    if (body["items"] is JsonObject items)
        foreach (var (mod, list) in items)
            if (Db.Modules.Contains(mod) && list is JsonArray arr)
                foreach (var n in arr)
                    if (n is JsonObject o && o["id"]?.GetValue<string>() is { Length: > 0 } iid)
                        await Db.UpsertItemAsync(c, tx, mod, iid, o, Me(ctx).Username, log: false);
    await Db.ExecAsync(c, "INSERT dbo.Activity(Username, Action, Module, Title) VALUES(@by, N'import', N'all', N'استعادة نسخة احتياطية')", tx, ("@by", Me(ctx).Username));
    await tx.CommitAsync();
    return Results.Json(new { ok = true });
});

// ---------- files & attachments ----------
app.MapPost("/api/files", async (HttpContext ctx) =>
{
    if (!ctx.Request.HasFormContentType) return Bad("form");
    var form = await ctx.Request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Bad("file");
    var id = "sv_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
    await using var ms = new MemoryStream();
    await file.CopyToAsync(ms);
    await using var c = await Db.OpenAsync(cs);
    await Db.ExecAsync(c, "INSERT dbo.Files(Id, FileName, FileType, Size, Data, CreatedBy) VALUES(@id,@n,@t,@s,@d,@by)",
        ("@id", id), ("@n", file.FileName), ("@t", file.ContentType ?? ""), ("@s", file.Length), ("@d", ms.ToArray()), ("@by", Me(ctx).Username));
    return Results.Json(new { id, size = file.Length });
});

app.MapGet("/api/files/{id}", async (string id) =>
{
    await using var c = await Db.OpenAsync(cs);
    await using var cmd = new SqlCommand("SELECT FileName, FileType, Data FROM dbo.Files WHERE Id=@id", c);
    cmd.Parameters.AddWithValue("@id", id);
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return Results.NotFound();
    var name = r.IsDBNull(0) ? "file" : r.GetString(0);
    var type = r.IsDBNull(1) || r.GetString(1) == "" ? "application/octet-stream" : r.GetString(1);
    var data = (byte[])r[2];
    return Results.File(data, type, fileDownloadName: null, enableRangeProcessing: true);
});

app.MapDelete("/api/files/{id}", async (string id) =>
{
    await using var c = await Db.OpenAsync(cs);
    await Db.ExecAsync(c, "DELETE FROM dbo.Files WHERE Id=@id", ("@id", id));
    return Results.Json(new { ok = true });
});

app.MapPut("/api/attachments/{id}", async (HttpContext ctx, string id, JsonObject doc) =>
{
    doc["id"] = id;
    await using var c = await Db.OpenAsync(cs);
    await Db.UpsertAttachmentAsync(c, id, doc, Me(ctx).Username);
    return Results.Json(new { ok = true });
});

app.MapDelete("/api/attachments/{id}", async (HttpContext ctx, string id) =>
{
    await using var c = await Db.OpenAsync(cs);
    await Db.ExecAsync(c, @"INSERT dbo.Activity(Username, Action, Module, ItemId, Title, CompanyId) SELECT @by, N'delete', N'attachments', Id, Title, CompanyId FROM dbo.Attachments WHERE Id=@id AND Deleted=0;
UPDATE dbo.Attachments SET Deleted=1, Content=NULL, Updated=SYSUTCDATETIME(), UpdatedBy=@by WHERE Id=@id", ("@id", id), ("@by", Me(ctx).Username));
    return Results.Json(new { ok = true });
});

// ---------- activity log ----------
app.MapGet("/api/activity", async (int? limit, string? company) =>
{
    await using var c = await Db.OpenAsync(cs);
    var n = Math.Clamp(limit ?? 100, 1, 500);
    var sql = $"SELECT TOP ({n}) a.At, a.Username, ISNULL(u.DisplayName, a.Username), a.Action, a.Module, a.ItemId, a.Title, a.CompanyId FROM dbo.Activity a LEFT JOIN dbo.Users u ON u.Username=a.Username"
            + (string.IsNullOrEmpty(company) || company == "all" ? "" : " WHERE a.CompanyId=@co")
            + " ORDER BY a.At DESC";
    await using var cmd = new SqlCommand(sql, c);
    if (!string.IsNullOrEmpty(company) && company != "all") cmd.Parameters.AddWithValue("@co", company);
    var list = new List<object>();
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        list.Add(new { at = DateTime.SpecifyKind(r.GetDateTime(0), DateTimeKind.Utc), user = r.IsDBNull(1) ? null : r.GetString(1), name = r.IsDBNull(2) ? null : r.GetString(2), action = r.GetString(3), module = r.GetString(4), itemId = r.IsDBNull(5) ? null : r.GetString(5), title = r.IsDBNull(6) ? null : r.GetString(6), company = r.IsDBNull(7) ? null : r.GetString(7) });
    return Results.Json(list);
});

// ---------- backups ----------
var backupDir = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, app.Configuration["BackupFolder"] ?? @"..\..\exec-office-backups"));
var backupLock = new SemaphoreSlim(1, 1);
async Task<object> RunBackupAsync(string reason)
{
    await backupLock.WaitAsync();
    try
    {
        Directory.CreateDirectory(backupDir);
        var stamp = DateTime.Now.ToString("yyyy-MM-dd_HHmmss");
        var dbFile = new SqlConnectionStringBuilder(cs).InitialCatalog;
        await using var c = await Db.OpenAsync(cs);
        // 1) نسخة بيانات JSON (الشركات والعناصر وبيانات المرفقات) — بنفس صيغة النسخة الاحتياطية في الموقع
        var items = new Dictionary<string, List<JsonNode?>>();
        foreach (var m in Db.Modules) items[m] = new();
        foreach (var row in await Db.ItemRowsAsync(c, null)) items[row.Module].Add(row.Doc);
        var json = JsonSerializer.Serialize(new { companies = await Db.CompaniesAsync(c), items, attachments = (await Db.AttachmentRowsAsync(c, null)).Select(a => a.Doc), exportedAt = DateTime.UtcNow, reason },
            new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        var jsonPath = Path.Combine(backupDir, $"{dbFile}_{stamp}.json");
        await File.WriteAllTextAsync(jsonPath, json);
        // 2) نسخة كاملة من القاعدة (.bak) فيها الملفات كمان — بتتحفظ في فولدر النسخ الافتراضي لـ SQL Server
        string? bakPath = null, bakError = null;
        try
        {
            var dir = (string?)await Db.ScalarAsync(c, "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400))");
            if (!string.IsNullOrEmpty(dir))
            {
                bakPath = Path.Combine(dir, $"{dbFile}_{stamp}.bak");
                var dbName = new SqlConnectionStringBuilder(cs).InitialCatalog;
                await using var cmd = new SqlCommand($"BACKUP DATABASE [{dbName.Replace("]", "]]")}] TO DISK = @p WITH INIT, COPY_ONLY", c) { CommandTimeout = 600 };
                cmd.Parameters.AddWithValue("@p", bakPath);
                await cmd.ExecuteNonQueryAsync();
                try { await Db.ExecAsync(c, "EXEC master.sys.xp_delete_file 0, @d, N'bak', @cut, 0", ("@d", dir), ("@cut", DateTime.Now.AddDays(-30))); } catch { /* cleanup is optional */ }
            }
        }
        catch (Exception ex) { bakError = ex.Message; bakPath = null; }
        // نحتفظ بآخر 30 نسخة JSON
        foreach (var old in new DirectoryInfo(backupDir).GetFiles("ExecOffice_*.json").OrderByDescending(f => f.Name).Skip(30)) old.Delete();
        var info = new { at = DateTime.UtcNow, json = jsonPath, bak = bakPath, bakError, reason };
        await File.WriteAllTextAsync(Path.Combine(backupDir, "last-backup.json"), JsonSerializer.Serialize(info));
        app.Logger.LogInformation("Backup done: {Json} / {Bak} {Err}", jsonPath, bakPath, bakError);
        return info;
    }
    finally { backupLock.Release(); }
}
app.MapGet("/api/backup/status", async () =>
{
    var f = Path.Combine(backupDir, "last-backup.json");
    return Results.Json(new { folder = backupDir, last = File.Exists(f) ? JsonNode.Parse(await File.ReadAllTextAsync(f)) : null });
});
app.MapPost("/api/backup/now", async (HttpContext ctx) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    try { return Results.Json(await RunBackupAsync("manual")); }
    catch (Exception ex) { return Bad("تعذّر عمل النسخة الاحتياطية: " + ex.Message); }
});
// نسخة تلقائية كل يوم (أول ما السيرفر يشتغل لو آخر نسخة قديمة، وبعدين كل ساعة نتأكد)
_ = Task.Run(async () =>
{
    await Task.Delay(TimeSpan.FromSeconds(20));
    while (true)
    {
        try
        {
            var f = Path.Combine(backupDir, "last-backup.json");
            DateTime last = DateTime.MinValue;
            if (File.Exists(f) && JsonNode.Parse(await File.ReadAllTextAsync(f))?["at"]?.GetValue<DateTime>() is DateTime d) last = d;
            if (DateTime.UtcNow - last > TimeSpan.FromHours(23)) await RunBackupAsync("daily");
        }
        catch (Exception ex) { app.Logger.LogWarning("Daily backup failed: {Msg}", ex.Message); }
        await Task.Delay(TimeSpan.FromHours(1));
    }
});

// ---------- واتساب التلقائي ----------
var wa = new WaService(cs, app.Logger, app.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("ExecOffice.WhatsApp.Token"));
app.MapGet("/api/wa/settings", async (HttpContext ctx) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    return Results.Json(wa.Public(await wa.LoadAsync()));
});
app.MapPut("/api/wa/settings", async (HttpContext ctx, JsonObject b) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    var s = await wa.LoadAsync();
    string? Str(string k) => b[k] is JsonValue v && v.TryGetValue<string>(out var x) ? x.Trim() : null;
    if (b["enabled"] is JsonValue ev && ev.TryGetValue<bool>(out var en))
    {
        if (en && !s.Enabled) s.EnabledAt = DateTime.UtcNow;
        s.Enabled = en;
    }
    if (Str("phoneNumberId") is string pid) s.PhoneNumberId = new string(pid.Where(char.IsAsciiDigit).ToArray());
    if (Str("token") is string tok && tok.Length > 0) wa.SetToken(s, tok);
    if (b["clearToken"] is JsonValue cv && cv.TryGetValue<bool>(out var clr) && clr) wa.SetToken(s, null);
    if (Str("apiVersion") is string ver && System.Text.RegularExpressions.Regex.IsMatch(ver, @"^v\d+\.\d+$")) s.ApiVersion = ver;
    if (Str("template") is string tpl) s.Template = System.Text.RegularExpressions.Regex.IsMatch(tpl, "^[a-z0-9_]{0,512}$") ? tpl : s.Template;
    if (Str("lang") is string lang && System.Text.RegularExpressions.Regex.IsMatch(lang, "^[A-Za-z_]{2,8}$")) s.Lang = lang;
    if (Str("directorPhone") is string dp) s.DirectorPhone = dp;
    if (Str("secretaryPhone") is string sp) s.SecretaryPhone = sp;
    if (Str("briefTime") is string bt && TimeSpan.TryParse(bt, out var btt) && btt < TimeSpan.FromDays(1)) s.BriefTime = $"{btt.Hours:00}:{btt.Minutes:00}";
    if (b["leadMinutes"] is JsonValue lv && lv.TryGetValue<int>(out var lead)) s.LeadMinutes = Math.Clamp(lead, 5, 1440);
    if (b["to"] is JsonObject to)
        foreach (var k in WaService.Kinds)
            if (to[k] is JsonValue tv && tv.TryGetValue<string>(out var t) && WaService.Targets.Contains(t)) s.To[k] = t;
    if (s.Enabled && (string.IsNullOrEmpty(s.PhoneNumberId) || string.IsNullOrEmpty(s.TokenEnc))) return Bad("لا يمكن التفعيل قبل إدخال معرّف الرقم والتوكن");
    await wa.SaveAsync(s);
    return Results.Json(wa.Public(s));
});
app.MapPost("/api/wa/test", async (HttpContext ctx, JsonObject b) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    var s = await wa.LoadAsync();
    var who = b["to"]?.ToString() == "secretary" ? s.SecretaryPhone : s.DirectorPhone;
    var phone = WaService.NormPhone(who);
    if (phone is null) return Bad("أدخل رقم الواتساب أولاً");
    var (ok, err) = await wa.SendAsync(s, phone, new[] { "رسالة تجربة من نظام مكتب المدير", "الإرسال التلقائي يعمل بنجاح." }, "test:" + DateTime.UtcNow.Ticks, "test");
    return ok ? Results.Json(new { ok = true }) : Bad("تعذّر الإرسال: " + err);
});
app.MapPost("/api/wa/brief", async (HttpContext ctx) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    var (ok, err) = await wa.SendBriefNowAsync(await wa.LoadAsync());
    return ok ? Results.Json(new { ok = true }) : Bad("تعذّر الإرسال: " + err);
});
app.MapGet("/api/wa/log", async (HttpContext ctx) =>
{
    if (Me(ctx).Role != "admin") return Forbidden();
    return Results.Json(await wa.LogAsync(60));
});
_ = Task.Run(async () =>
{
    await Task.Delay(TimeSpan.FromSeconds(15));
    while (true)
    {
        await wa.TickAsync();
        await Task.Delay(TimeSpan.FromSeconds(60));
    }
});

app.Run();

// =========================================================
record AppUser(int Id, string Username, string DisplayName, string Role);
record LoginBody(string? Username, string? Password, string? DisplayName, string? Role);
record PasswordBody(string? Current, string? Next);
record ItemRow(string Module, string Id, bool Deleted, JsonNode? Doc);
record AttRow(string Id, bool Deleted, JsonNode? Doc);

static class Auth
{
    public const string Cookie = "eo_session";
    const int Iterations = 120_000;

    public static string? Validate(string? user, string? pw)
    {
        if (string.IsNullOrWhiteSpace(user) || user.Trim().Length < 3) return "اسم المستخدم لازم يكون 3 حروف على الأقل";
        if (string.IsNullOrEmpty(pw) || pw.Length < 6) return "كلمة السر لازم تكون 6 حروف على الأقل";
        return null;
    }
    static (byte[] hash, byte[] salt) Hash(string pw, byte[]? salt = null)
    {
        salt ??= RandomNumberGenerator.GetBytes(16);
        return (Rfc2898DeriveBytes.Pbkdf2(pw, salt, Iterations, HashAlgorithmName.SHA256, 32), salt);
    }
    public static async Task<int> CreateUserAsync(SqlConnection c, string user, string display, string pw, string role)
    {
        var (h, s) = Hash(pw);
        return Convert.ToInt32(await Db.ScalarAsync(c,
            "INSERT dbo.Users(Username, DisplayName, PasswordHash, Salt, Role) OUTPUT INSERTED.Id VALUES(@u,@d,@h,@s,@r)",
            ("@u", user.Trim()), ("@d", display.Trim()), ("@h", h), ("@s", s), ("@r", role)));
    }
    public static async Task SetPasswordAsync(SqlConnection c, int id, string pw)
    {
        var (h, s) = Hash(pw);
        await Db.ExecAsync(c, "UPDATE dbo.Users SET PasswordHash=@h, Salt=@s WHERE Id=@id", ("@h", h), ("@s", s), ("@id", id));
    }
    public static async Task<AppUser?> CheckAsync(SqlConnection c, string user, string pw)
    {
        await using var cmd = new SqlCommand("SELECT Id, Username, DisplayName, Role, PasswordHash, Salt FROM dbo.Users WHERE Username=@u", c);
        cmd.Parameters.AddWithValue("@u", user.Trim());
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) return null;
        var (h, _) = Hash(pw, (byte[])r[5]);
        if (!CryptographicOperations.FixedTimeEquals(h, (byte[])r[4])) return null;
        return new AppUser(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3));
    }
    public static async Task StartSessionAsync(SqlConnection c, HttpContext ctx, int userId)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var expires = DateTime.UtcNow.AddDays(30);
        await Db.ExecAsync(c, "DELETE FROM dbo.Sessions WHERE Expires < SYSUTCDATETIME(); INSERT dbo.Sessions(Token, UserId, Expires) VALUES(@t,@u,@e)", ("@t", token), ("@u", userId), ("@e", expires));
        ctx.Response.Cookies.Append(Cookie, token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Expires = expires, IsEssential = true, Secure = ctx.Request.IsHttps });
    }
    public static async Task<AppUser?> FromRequestAsync(string cs, HttpContext ctx)
    {
        if (!ctx.Request.Cookies.TryGetValue(Cookie, out var token) || token.Length != 64) return null;
        await using var c = await Db.OpenAsync(cs);
        await using var cmd = new SqlCommand("SELECT u.Id, u.Username, u.DisplayName, u.Role FROM dbo.Sessions s JOIN dbo.Users u ON u.Id=s.UserId WHERE s.Token=@t AND s.Expires > SYSUTCDATETIME()", c);
        cmd.Parameters.AddWithValue("@t", token);
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? new AppUser(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3)) : null;
    }
}

static class Db
{
    public static readonly HashSet<string> Modules = new() { "meetings", "cases", "travel", "contracts", "approvals", "tasks", "calls", "contacts", "finance" };
    static readonly Dictionary<string, string> DateField = new() { ["meetings"] = "date", ["cases"] = "nextHearing", ["travel"] = "departDate", ["contracts"] = "endDate", ["approvals"] = "dueDate", ["tasks"] = "dueDate", ["calls"] = "date", ["finance"] = "date" };
    static readonly Dictionary<string, string> TitleField = new() { ["calls"] = "caller", ["contacts"] = "name", ["travel"] = "destination" };

    public static async Task<SqlConnection> OpenAsync(string cs)
    {
        var c = new SqlConnection(cs);
        await c.OpenAsync();
        return c;
    }
    static void Add(SqlCommand cmd, (string name, object? value)[] ps)
    {
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
    }
    public static async Task<object?> ScalarAsync(SqlConnection c, string sql, params (string, object?)[] ps)
    {
        await using var cmd = new SqlCommand(sql, c);
        Add(cmd, ps);
        var v = await cmd.ExecuteScalarAsync();
        return v is DBNull ? null : v;
    }
    public static Task ExecAsync(SqlConnection c, string sql, params (string, object?)[] ps) => ExecAsync(c, sql, null, ps);
    public static async Task ExecAsync(SqlConnection c, string sql, SqlTransaction? tx, params (string, object?)[] ps)
    {
        await using var cmd = new SqlCommand(sql, c, tx);
        Add(cmd, ps);
        await cmd.ExecuteNonQueryAsync();
    }
    public static async Task<string> NowAsync(SqlConnection c) =>
        ((DateTime)(await ScalarAsync(c, "SELECT SYSUTCDATETIME()"))!).ToString("o");

    public static async Task EnsureSchemaAsync(string cs, string schemaFile)
    {
        var b = new SqlConnectionStringBuilder(cs);
        var dbName = b.InitialCatalog;
        b.InitialCatalog = "master";
        await using (var m = await OpenAsync(b.ConnectionString))
            await ExecAsync(m, $"IF DB_ID(@n) IS NULL EXEC('CREATE DATABASE [{dbName.Replace("]", "]]")}]')", ("@n", dbName));
        if (!File.Exists(schemaFile)) return;
        var script = await File.ReadAllTextAsync(schemaFile);
        await using var c = await OpenAsync(cs);
        foreach (var batch in System.Text.RegularExpressions.Regex.Split(script, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline | System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        {
            var sql = batch.Trim();
            if (sql.Length == 0 || sql.Contains("CREATE DATABASE", StringComparison.OrdinalIgnoreCase) || sql.StartsWith("USE ", StringComparison.OrdinalIgnoreCase)) continue;
            await ExecAsync(c, sql);
        }
    }

    public static async Task<List<object>> CompaniesAsync(SqlConnection c)
    {
        var list = new List<object>();
        await using var cmd = new SqlCommand("SELECT Id, Name, Color FROM dbo.Companies ORDER BY SortOrder, Name", c);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) list.Add(new { id = r.GetString(0), name = r.GetString(1), color = r.GetString(2) });
        return list;
    }
    public static async Task ReplaceCompaniesAsync(SqlConnection c, SqlTransaction? tx, JsonArray arr)
    {
        await ExecAsync(c, "DELETE FROM dbo.Companies", tx);
        var i = 0;
        foreach (var n in arr)
        {
            if (n is not JsonObject o) continue;
            await ExecAsync(c, "INSERT dbo.Companies(Id, Name, Color, SortOrder) VALUES(@id,@n,@c,@s)", tx,
                ("@id", Str(o, "id") ?? Guid.NewGuid().ToString("N")), ("@n", Str(o, "name") ?? ""), ("@c", Str(o, "color") ?? "#145550"), ("@s", i++));
        }
    }

    static string? Str(JsonObject o, string key)
    {
        try { return o[key] is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : v.ToString()) : null; }
        catch { return null; }
    }
    static object? DateOrNull(string? s) => DateTime.TryParse(s, out var d) ? d.Date : null;
    static string? Cut(string? s, int n) => s is null ? null : s.Length <= n ? s : s[..n];

    public static async Task UpsertItemAsync(SqlConnection c, SqlTransaction? tx, string mod, string id, JsonObject doc, string by, bool log = true)
    {
        var title = Str(doc, TitleField.GetValueOrDefault(mod, "title"));
        var date = DateField.TryGetValue(mod, out var df) ? DateOrNull(Str(doc, df)) : null;
        await ExecAsync(c, @"
DECLARE @ex BIT = CASE WHEN EXISTS(SELECT 1 FROM dbo.Items WHERE Module=@m AND Id=@id AND Deleted=0) THEN 1 ELSE 0 END;
MERGE dbo.Items AS t USING (SELECT @m AS Module, @id AS Id) AS s ON t.Module=s.Module AND t.Id=s.Id
WHEN MATCHED THEN UPDATE SET CompanyId=@co, Title=@ti, Status=@st, Priority=@pr, MainDate=@dt, Data=@data, Deleted=0, Updated=SYSUTCDATETIME(), UpdatedBy=@by
WHEN NOT MATCHED THEN INSERT(Module, Id, CompanyId, Title, Status, Priority, MainDate, Data, UpdatedBy) VALUES(@m,@id,@co,@ti,@st,@pr,@dt,@data,@by);
IF @log = 1 INSERT dbo.Activity(Username, Action, Module, ItemId, Title, CompanyId) VALUES(@by, CASE @ex WHEN 1 THEN N'edit' ELSE N'add' END, @m, @id, @ti, @co);", tx,
            ("@m", mod), ("@id", id), ("@co", Str(doc, "company")), ("@ti", Cut(title, 400)), ("@st", Cut(Str(doc, "status"), 64)),
            ("@pr", Cut(Str(doc, "priority"), 16)), ("@dt", date), ("@data", doc.ToJsonString()), ("@by", by), ("@log", log));
    }

    public static async Task UpsertAttachmentAsync(SqlConnection c, string id, JsonObject doc, string by)
    {
        long? size = doc["size"] is JsonValue sv && sv.TryGetValue<long>(out var l) ? l : null;
        await ExecAsync(c, @"
DECLARE @ex BIT = CASE WHEN EXISTS(SELECT 1 FROM dbo.Attachments WHERE Id=@id AND Deleted=0) THEN 1 ELSE 0 END;
MERGE dbo.Attachments AS t USING (SELECT @id AS Id) AS s ON t.Id=s.Id
WHEN MATCHED THEN UPDATE SET CompanyId=@co, Title=@ti, Category=@ca, DocDate=@dd, FileName=@fn, FileId=@fi, Size=@sz, Content=@ct, Meta=@meta, Deleted=0, Updated=SYSUTCDATETIME(), UpdatedBy=@by
WHEN NOT MATCHED THEN INSERT(Id, CompanyId, Title, Category, DocDate, FileName, FileId, Size, Content, Meta, UpdatedBy) VALUES(@id,@co,@ti,@ca,@dd,@fn,@fi,@sz,@ct,@meta,@by);
INSERT dbo.Activity(Username, Action, Module, ItemId, Title, CompanyId) VALUES(@by, CASE @ex WHEN 1 THEN N'edit' ELSE N'add' END, N'attachments', @id, @ti, @co);",
            ("@id", id), ("@co", Str(doc, "company")), ("@ti", Cut(Str(doc, "title"), 400)), ("@ca", Cut(Str(doc, "category"), 100)),
            ("@dd", DateOrNull(Str(doc, "docDate"))), ("@fn", Cut(Str(doc, "fileName"), 400)), ("@fi", Cut(Str(doc, "assetId"), 64)),
            ("@sz", size), ("@ct", Str(doc, "content")), ("@meta", doc.ToJsonString()), ("@by", by));
    }

    public static async Task<List<ItemRow>> ItemRowsAsync(SqlConnection c, DateTime? since)
    {
        var list = new List<ItemRow>();
        var sql = since is null ? "SELECT Module, Id, Deleted, Data FROM dbo.Items WHERE Deleted=0" : "SELECT Module, Id, Deleted, Data FROM dbo.Items WHERE Updated >= @s";
        await using var cmd = new SqlCommand(sql, c);
        if (since is not null) cmd.Parameters.AddWithValue("@s", since.Value);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var mod = r.GetString(0);
            if (!Modules.Contains(mod)) continue;
            JsonNode? doc = null;
            try { doc = JsonNode.Parse(r.GetString(3)); } catch { }
            list.Add(new ItemRow(mod, r.GetString(1), r.GetBoolean(2), doc));
        }
        return list;
    }
    public static async Task<List<AttRow>> AttachmentRowsAsync(SqlConnection c, DateTime? since)
    {
        var list = new List<AttRow>();
        var sql = since is null ? "SELECT Id, Deleted, Meta FROM dbo.Attachments WHERE Deleted=0" : "SELECT Id, Deleted, Meta FROM dbo.Attachments WHERE Updated >= @s";
        await using var cmd = new SqlCommand(sql, c);
        if (since is not null) cmd.Parameters.AddWithValue("@s", since.Value);
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            JsonNode? doc = null;
            try { doc = JsonNode.Parse(r.GetString(2)); } catch { }
            list.Add(new AttRow(r.GetString(0), r.GetBoolean(1), doc));
        }
        return list;
    }
}
