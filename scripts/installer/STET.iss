; The Windows installer, STET-Setup.exe (Inno Setup 6).
;
;   iscc /DAppVersion=0.19.4 /DAppFiles=..\..\dist\STET-v0.19.4-win32-x64 scripts\installer\STET.iss
;
; Installs for the current user only, so Windows never asks for an administrator:
; the program goes to %LOCALAPPDATA%\Programs\STET, with a Start menu shortcut, an
; optional desktop shortcut, .stet files opening in STET, and an uninstaller in
; Settings > Apps. Installing a newer version over an older one updates it in place.
; Screenplays and STET's settings and statistics (%APPDATA%\STET) are never touched,
; not even by the uninstaller.

#ifndef AppVersion
  #error Pass /DAppVersion=X.Y.Z
#endif
#ifndef AppFiles
  #error Pass /DAppFiles=<the packaged STET-vX.Y.Z-win32-x64 folder>
#endif

[Setup]
; Never change AppId: Windows uses it to recognise an update of the same program.
AppId={{51B10B2F-DC96-4E93-8E4C-52BFC1015D8B}
AppName=STET
AppVersion={#AppVersion}
AppVerName=STET {#AppVersion}
AppPublisher=STET
AppPublisherURL=https://github.com/mediocrecode56/stet-screenwriter
VersionInfoVersion={#AppVersion}
VersionInfoDescription=STET Setup
DefaultDirName={autopf}\STET
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupIconFile=..\..\build\icon.ico
UninstallDisplayIcon={app}\STET.exe
UninstallDisplayName=STET
CloseApplications=yes
ChangesAssociations=yes
Compression=lzma2/max
SolidCompression=yes
OutputDir=.
OutputBaseFilename=STET-Setup

[Tasks]
Name: desktopicon; Description: "Put a shortcut to STET on the desktop"

[InstallDelete]
; An update replaces the program's files completely, so nothing from the previous version lingers.
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"

[Files]
Source: "{#AppFiles}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; The same AppUserModelID as src/main/main.js, so the shortcut and the running window share one taskbar button.
Name: "{autoprograms}\STET"; Filename: "{app}\STET.exe"; AppUserModelID: "app.stet.screenwriting"
Name: "{autodesktop}\STET"; Filename: "{app}\STET.exe"; AppUserModelID: "app.stet.screenwriting"; Tasks: desktopicon

[Registry]
; Double-clicking a .stet screenplay opens it in STET.
Root: HKA; Subkey: "Software\Classes\.stet"; ValueType: string; ValueName: ""; ValueData: "STET.Screenplay"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.stet\OpenWithProgids"; ValueType: string; ValueName: "STET.Screenplay"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\STET.Screenplay"; ValueType: string; ValueName: ""; ValueData: "STET Screenplay"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\STET.Screenplay\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\STET.exe,0"
Root: HKA; Subkey: "Software\Classes\STET.Screenplay\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\STET.exe"" ""%1"""

[Run]
Filename: "{app}\STET.exe"; Description: "Open STET"; Flags: nowait postinstall skipifsilent
