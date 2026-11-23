/* =========================================================
   قاعدة بيانات مكتب المدير — SQL Server
   السيرفر بينشئ القاعدة والجداول دي لوحده أول ما يشتغل.
   الملف ده للمرجعية، أو لو حبيت تنشئها يدوياً من SSMS.
   ========================================================= */
IF DB_ID(N'ExecOffice') IS NULL CREATE DATABASE ExecOffice;
GO
USE ExecOffice;
GO

-- المستخدمين (كلمات السر متخزنة PBKDF2-SHA256 مع salt)
IF OBJECT_ID(N'dbo.Users') IS NULL
CREATE TABLE dbo.Users (
  Id           INT IDENTITY(1,1) PRIMARY KEY,
  Username     NVARCHAR(64)  NOT NULL UNIQUE,
  DisplayName  NVARCHAR(128) NOT NULL,
  PasswordHash VARBINARY(64) NOT NULL,
  Salt         VARBINARY(32) NOT NULL,
  Role         NVARCHAR(16)  NOT NULL CONSTRAINT DF_Users_Role DEFAULT N'user',   -- admin | user
  Created      DATETIME2     NOT NULL CONSTRAINT DF_Users_Created DEFAULT SYSUTCDATETIME()
);

-- جلسات الدخول
IF OBJECT_ID(N'dbo.Sessions') IS NULL
CREATE TABLE dbo.Sessions (
  Token   CHAR(64)  NOT NULL PRIMARY KEY,
  UserId  INT       NOT NULL REFERENCES dbo.Users(Id) ON DELETE CASCADE,
  Expires DATETIME2 NOT NULL
);

-- الشركات
IF OBJECT_ID(N'dbo.Companies') IS NULL
CREATE TABLE dbo.Companies (
  Id        NVARCHAR(64)  NOT NULL PRIMARY KEY,
  Name      NVARCHAR(200) NOT NULL,
  Color     NVARCHAR(16)  NOT NULL,
  SortOrder INT           NOT NULL CONSTRAINT DF_Companies_Sort DEFAULT 0,
  Updated   DATETIME2     NOT NULL CONSTRAINT DF_Companies_Updated DEFAULT SYSUTCDATETIME()
);

-- كل عناصر الأقسام (مواعيد، قضايا، رحلات، عقود، موافقات، مهام، مكالمات، جهات اتصال)
-- Data فيه العنصر كامل JSON، والأعمدة التانية متاخدة منه علشان الاستعلامات والتقارير
IF OBJECT_ID(N'dbo.Items') IS NULL
CREATE TABLE dbo.Items (
  Module    NVARCHAR(32)  NOT NULL,      -- meetings | cases | travel | contracts | approvals | tasks | calls | contacts
  Id        NVARCHAR(200) NOT NULL,
  CompanyId NVARCHAR(64)  NULL,
  Title     NVARCHAR(400) NULL,
  Status    NVARCHAR(64)  NULL,
  Priority  NVARCHAR(16)  NULL,
  MainDate  DATE          NULL,          -- تاريخ الموعد / الجلسة / السفر / انتهاء العقد...
  Data      NVARCHAR(MAX) NOT NULL,
  Deleted   BIT           NOT NULL CONSTRAINT DF_Items_Deleted DEFAULT 0,
  Created   DATETIME2     NOT NULL CONSTRAINT DF_Items_Created DEFAULT SYSUTCDATETIME(),
  Updated   DATETIME2     NOT NULL CONSTRAINT DF_Items_Updated DEFAULT SYSUTCDATETIME(),
  UpdatedBy NVARCHAR(64)  NULL,
  CONSTRAINT PK_Items PRIMARY KEY (Module, Id)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Items_Updated')
  CREATE INDEX IX_Items_Updated ON dbo.Items(Updated);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Items_Company')
  CREATE INDEX IX_Items_Company ON dbo.Items(CompanyId, Module) INCLUDE (MainDate, Status);

-- الملفات نفسها
IF OBJECT_ID(N'dbo.Files') IS NULL
CREATE TABLE dbo.Files (
  Id        NVARCHAR(64)   NOT NULL PRIMARY KEY,
  FileName  NVARCHAR(400)  NULL,
  FileType  NVARCHAR(200)  NULL,
  Size      BIGINT         NOT NULL,
  Data      VARBINARY(MAX) NOT NULL,
  Created   DATETIME2      NOT NULL CONSTRAINT DF_Files_Created DEFAULT SYSUTCDATETIME(),
  CreatedBy NVARCHAR(64)   NULL
);

-- بيانات المرفقات (العنوان، التصنيف، التاريخ، النص المستخرج...)
IF OBJECT_ID(N'dbo.Attachments') IS NULL
CREATE TABLE dbo.Attachments (
  Id        NVARCHAR(200) NOT NULL PRIMARY KEY,
  CompanyId NVARCHAR(64)  NULL,
  Title     NVARCHAR(400) NULL,
  Category  NVARCHAR(100) NULL,
  DocDate   DATE          NULL,
  FileName  NVARCHAR(400) NULL,
  FileId    NVARCHAR(64)  NULL,
  Size      BIGINT        NULL,
  Content   NVARCHAR(MAX) NULL,
  Meta      NVARCHAR(MAX) NOT NULL,
  Deleted   BIT           NOT NULL CONSTRAINT DF_Att_Deleted DEFAULT 0,
  Created   DATETIME2     NOT NULL CONSTRAINT DF_Att_Created DEFAULT SYSUTCDATETIME(),
  Updated   DATETIME2     NOT NULL CONSTRAINT DF_Att_Updated DEFAULT SYSUTCDATETIME(),
  UpdatedBy NVARCHAR(64)  NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Att_Updated')
  CREATE INDEX IX_Att_Updated ON dbo.Attachments(Updated);
GO

-- سجل النشاط: مين عمل إيه وإمتى
IF OBJECT_ID(N'dbo.Activity') IS NULL
CREATE TABLE dbo.Activity (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  At        DATETIME2     NOT NULL CONSTRAINT DF_Activity_At DEFAULT SYSUTCDATETIME(),
  Username  NVARCHAR(64)  NULL,
  Action    NVARCHAR(16)  NOT NULL,     -- add | edit | delete
  Module    NVARCHAR(32)  NOT NULL,
  ItemId    NVARCHAR(200) NULL,
  Title     NVARCHAR(400) NULL,
  CompanyId NVARCHAR(64)  NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Activity_At')
  CREATE INDEX IX_Activity_At ON dbo.Activity(At DESC);
GO

-- إعدادات عامة (منها إعدادات واتساب، والتوكن متشفّر)
IF OBJECT_ID(N'dbo.Settings') IS NULL
CREATE TABLE dbo.Settings (
  [Key]   NVARCHAR(100) NOT NULL PRIMARY KEY,
  Value   NVARCHAR(MAX) NULL,
  Updated DATETIME2     NOT NULL CONSTRAINT DF_Settings_Updated DEFAULT SYSUTCDATETIME()
);

-- سجل رسائل واتساب التلقائية (المفتاح بيمنع تكرار نفس الرسالة)
IF OBJECT_ID(N'dbo.WaLog') IS NULL
CREATE TABLE dbo.WaLog (
  Id      INT IDENTITY(1,1) PRIMARY KEY,
  [Key]   NVARCHAR(300) NOT NULL,
  Kind    NVARCHAR(32)  NOT NULL,
  ToPhone NVARCHAR(32)  NULL,
  Body    NVARCHAR(MAX) NULL,
  Ok      BIT           NOT NULL,
  Error   NVARCHAR(MAX) NULL,
  MsgId   NVARCHAR(200) NULL,
  At      DATETIME2     NOT NULL CONSTRAINT DF_WaLog_At DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WaLog_Key')
  CREATE INDEX IX_WaLog_Key ON dbo.WaLog([Key]);
