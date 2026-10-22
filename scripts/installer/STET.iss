; The Windows installer, STET-Setup.exe (Inno Setup 6).
;
;   iscc /DAppVersion=0.19.4 /DAppFiles=..\..\dist\STET-v0.19.4-win32-x64 scripts\installer\STET.iss
;
; Installs for the current user only, so Windows never asks for an administrator:
; the program goes to %LOCALAPPDATA%\Programs\STET, with a Start menu shortcut, an
; optional desktop shortcut, .stet files opening in STET (ticked; Help > Open .stet Files
; with STET does the same later), and an uninstaller in Settings > Apps.
;
; It looks for an installed STET first:
;   none            a normal install (one page: the shortcut and .stet file choices);
;   older version   an update: one confirmation, then the program files are replaced
;                   in the same folder, keeping the earlier choices;
;   same version    offers to open STET instead (or reinstall it, to repair);
;   newer version   stops: it never downgrades.
; STET's own updater (src/main/update.js) runs it only when a release needs a new Electron
; (other updates are small patches that need no installer), with /VERYSILENT /relaunch=1:
; nothing on screen. It waits for STET to have closed completely, updates, and opens
; STET again.
; Screenplays and STET's settings and statistics (%APPDATA%\STET) are never touched,
; not by installing, updating or uninstalling.

#ifndef AppVersion
  #error Pass /DAppVersion=X.Y.Z
#endif
#ifndef AppFiles
  #error Pass /DAppFiles=<the packaged STET-vX.Y.Z-win32-x64 folder>
#endif

; Never change the GUID: Windows uses it to recognise an update of the same program.
#define AppGuid "51B10B2F-DC96-4E93-8E4C-52BFC1015D8B"

[Setup]
AppId={{{#AppGuid}}
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
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupIconFile=..\..\build\icon.ico
UninstallDisplayIcon={app}\STET.exe
UninstallDisplayName=STET
CloseApplications=force
RestartApplications=no
ChangesAssociations=yes
Compression=lzma2/max
SolidCompression=yes
OutputDir=.
OutputBaseFilename=STET-Setup

[Tasks]
Name: desktopicon; Description: "Put a shortcut to STET on the desktop"
Name: assoc; Description: "Open .stet screenplays with STET"

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
; Double-clicking a .stet screenplay opens it in STET (src/main/assoc.js writes the same keys).
Root: HKA; Subkey: "Software\Classes\.stet"; ValueType: string; ValueName: ""; ValueData: "STET.Screenplay"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.stet\OpenWithProgids"; ValueType: string; ValueName: "STET.Screenplay"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\STET.Screenplay"; ValueType: string; ValueName: ""; ValueData: "STET Screenplay"; Flags: uninsdeletekey; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\STET.Screenplay\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\STET.exe,0"; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\STET.Screenplay\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\STET.exe"" ""%1"""; Tasks: assoc
; STET as an app that opens .stet files, listed in Settings > Default apps.
Root: HKA; Subkey: "Software\STET\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "STET"; Flags: uninsdeletekey; Tasks: assoc
Root: HKA; Subkey: "Software\STET\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Screenwriting"; Tasks: assoc
Root: HKA; Subkey: "Software\STET\Capabilities\FileAssociations"; ValueType: string; ValueName: ".stet"; ValueData: "STET.Screenplay"; Tasks: assoc
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "STET"; ValueData: "Software\STET\Capabilities"; Flags: uninsdeletevalue; Tasks: assoc
; What Explorer remembered about .stet files (an earlier "Open with" choice, apps tried once)
; would win over the lines above or make Windows ask again: cleared, as src/main/assoc.js does.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.stet"; Flags: deletekey; Tasks: assoc

[Run]
Filename: "{app}\STET.exe"; Description: "Open STET"; Flags: nowait postinstall skipifsilent
; An update started from inside STET runs silently with /relaunch=1: STET opens again afterwards.
Filename: "{app}\STET.exe"; Flags: nowait; Check: RelaunchRequested

[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1';

var
  InstalledVersion: String; // '' when STET isn't installed
  Updating: Boolean;        // an older version is installed

function RelaunchRequested(): Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

// The next number of a dotted version string, consuming it.
function NextPart(var S: String): Integer;
var
  P: Integer;
begin
  P := Pos('.', S);
  if P = 0 then
  begin
    Result := StrToIntDef(S, 0);
    S := '';
  end
  else
  begin
    Result := StrToIntDef(Copy(S, 1, P - 1), 0);
    Delete(S, 1, P);
  end;
end;

// -1, 0 or 1 as version A is older than, the same as, or newer than B.
function CompareVersions(A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  for I := 1 to 3 do
  begin
    X := NextPart(A);
    Y := NextPart(B);
    if X > Y then begin Result := 1; Exit; end;
    if X < Y then begin Result := -1; Exit; end;
  end;
end;

function InitializeSetup(): Boolean;
var
  Location: String;
  Labels: TArrayOfString;
  Choice, Code: Integer;
begin
  Result := True;
  if not RegQueryStringValue(HKA, UninstallKey, 'DisplayVersion', InstalledVersion) then
    InstalledVersion := '';
  if InstalledVersion = '' then
    Exit;

  case CompareVersions(InstalledVersion, '{#AppVersion}') of
    1:
      begin
        if not WizardSilent() then
          MsgBox('A newer version of STET (' + InstalledVersion + ') is already installed, so there is nothing to do.', mbInformation, MB_OK);
        Result := False;
      end;
    0:
      if not WizardSilent() then
      begin
        SetArrayLength(Labels, 2);
        Labels[0] := 'Open STET';
        Labels[1] := 'Reinstall';
        Choice := TaskDialogMsgBox('STET {#AppVersion} is already installed.',
          'It is up to date. You can open it, or reinstall it if something seems wrong.',
          mbInformation, MB_YESNOCANCEL, Labels, 0);
        if Choice = IDYES then
        begin
          if RegQueryStringValue(HKA, UninstallKey, 'InstallLocation', Location) then
            ShellExec('', AddBackslash(Location) + 'STET.exe', '', '', SW_SHOWNORMAL, ewNoWait, Code);
          Result := False;
        end
        else if Choice <> IDNO then
          Result := False;
      end;
    -1:
      Updating := True;
  end;
end;

// Started by STET's updater: wait until STET has closed completely (every one of its
// processes) before any file is replaced, so nothing is in use. At most 30 seconds;
// anything still running after that is closed by Setup (CloseApplications=force).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Pid, Code: Integer;
  Cmd, AppDir: String;
begin
  Result := '';
  if not RelaunchRequested() then
    Exit;
  Cmd := '';
  Pid := StrToIntDef(ExpandConstant('{param:waitpid|0}'), 0);
  if Pid > 0 then
    Cmd := 'Wait-Process -Id ' + IntToStr(Pid) + ' -Timeout 30 -ErrorAction SilentlyContinue; ';
  AppDir := ExpandConstant('{app}');
  StringChangeEx(AppDir, '''', '''''', True); // a quote in the folder name, inside a PowerShell string
  Cmd := Cmd + 'Get-Process STET -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' + AppDir + '\*'' } | Wait-Process -Timeout 30 -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' + Cmd + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// An update asks nothing again: the shortcut choice from last time is kept.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = wpSelectTasks) and Updating;
  if (PageID = wpReady) and not Updating then
    Result := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpReady) and Updating then
  begin
    WizardForm.PageNameLabel.Caption := 'Update STET';
    WizardForm.PageDescriptionLabel.Caption := 'STET ' + InstalledVersion + ' will be updated to {#AppVersion}.';
    WizardForm.ReadyLabel.Caption := 'Your screenplays, settings and writing statistics stay exactly as they are. If STET is open, it closes first and saves your work, as it always does.';
    WizardForm.ReadyMemo.Visible := False;
    WizardForm.NextButton.Caption := 'Update';
  end;
end;

// Uninstalling also removes a link made later from Help > Open .stet Files with STET, if it
// points at this STET.exe (a portable copy's link is left alone).
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Command, Kind: String;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;
  if RegQueryStringValue(HKCU, 'Software\Classes\STET.Screenplay\shell\open\command', '', Command) and
     (Pos(Lowercase(ExpandConstant('{app}\STET.exe')), Lowercase(Command)) > 0) then
  begin
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\STET.Screenplay');
    RegDeleteValue(HKCU, 'Software\Classes\.stet\OpenWithProgids', 'STET.Screenplay');
    if RegQueryStringValue(HKCU, 'Software\Classes\.stet', '', Kind) and (Kind = 'STET.Screenplay') then
      RegDeleteValue(HKCU, 'Software\Classes\.stet', '');
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\STET\Capabilities');
    RegDeleteKeyIfEmpty(HKCU, 'Software\STET');
    RegDeleteValue(HKCU, 'Software\RegisteredApplications', 'STET');
  end;
end;
