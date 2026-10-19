// STET.exe (unversioned, in Documents\STET): a self-contained single file.
//
// The packaged app (an Electron folder) is embedded as a zip resource. On the
// first launch of a given build it is unpacked once into
// %LOCALAPPDATA%\STET\runtime\<version>-<stamp>, then started from there; later
// launches start it immediately. Older unpacked builds are removed afterwards.
// Built by scripts/build-exe.js with the C# compiler that ships with Windows.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("STET")]
[assembly: AssemblyProduct("STET")]
[assembly: AssemblyDescription("STET screenwriting")]
[assembly: AssemblyCompany("STET")]
[assembly: AssemblyVersion("{{VERSION4}}")]
[assembly: AssemblyFileVersion("{{VERSION4}}")]
[assembly: AssemblyInformationalVersion("{{VERSION}}")]

static class Launcher
{
    const string Version = "{{VERSION}}";
    const string Stamp = "{{STAMP}}";

    [STAThread]
    static int Main(string[] args)
    {
        string baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "STET", "runtime");
        string dir = Path.Combine(baseDir, Version + "-" + Stamp);
        string exe = Path.Combine(dir, "STET.exe");
        try
        {
            if (!File.Exists(Path.Combine(dir, ".complete")))
            {
                using (var gate = new Mutex(false, "STET-unpack-" + Version + "-" + Stamp))
                {
                    try { gate.WaitOne(); } catch (AbandonedMutexException) { }
                    try { if (!File.Exists(Path.Combine(dir, ".complete"))) UnpackWithSplash(baseDir, dir); }
                    finally { gate.ReleaseMutex(); }
                }
            }
            var psi = new ProcessStartInfo(exe, JoinArgs(args)) { UseShellExecute = false, WorkingDirectory = Environment.CurrentDirectory };
            Process.Start(psi);
            CleanOld(baseDir, dir);
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show("STET could not start.\n\n" + e.Message, "STET " + Version, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static void UnpackWithSplash(string baseDir, string dir)
    {
        Exception failure = null;
        var form = new Form
        {
            Text = "STET", FormBorderStyle = FormBorderStyle.None, StartPosition = FormStartPosition.CenterScreen,
            Size = new Size(320, 70), BackColor = Color.FromArgb(22, 22, 22), ShowInTaskbar = true, TopMost = true,
        };
        try { form.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
        var label = new Label
        {
            Text = "STET " + Version + " · preparing first launch…", ForeColor = Color.FromArgb(240, 240, 237),
            Font = new Font("Consolas", 9f), Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter,
        };
        form.Controls.Add(label);
        form.Shown += delegate
        {
            var t = new Thread(delegate ()
            {
                try { Unpack(baseDir, dir); } catch (Exception e) { failure = e; }
                try { form.BeginInvoke((MethodInvoker)delegate { form.Close(); }); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        };
        Application.EnableVisualStyles();
        Application.Run(form);
        if (failure != null) throw failure;
    }

    static void Unpack(string baseDir, string dir)
    {
        Directory.CreateDirectory(baseDir);
        string tmp = dir + ".tmp-" + Process.GetCurrentProcess().Id;
        if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
        {
            if (s == null) throw new Exception("The packaged app is missing from this file.");
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                string root = Path.GetFullPath(tmp) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(tmp, e.FullName));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new Exception("Unsafe path in package: " + e.FullName);
                    if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    e.ExtractToFile(target, true);
                }
            }
        }
        File.WriteAllText(Path.Combine(tmp, ".complete"), Version + " " + Stamp);
        if (Directory.Exists(dir)) Directory.Delete(dir, true); // an earlier, interrupted unpack
        Directory.Move(tmp, dir);
    }

    static void CleanOld(string baseDir, string keep)
    {
        try
        {
            foreach (string d in Directory.GetDirectories(baseDir))
            {
                if (string.Equals(Path.GetFullPath(d), Path.GetFullPath(keep), StringComparison.OrdinalIgnoreCase)) continue;
                // Moving the folder fails while any file in it is open, so a running
                // older STET is never touched; it is cleaned up on a later launch.
                string doomed = d + ".old-" + Process.GetCurrentProcess().Id;
                try { Directory.Move(d, doomed); } catch { continue; }
                try { Directory.Delete(doomed, true); } catch { }
            }
        }
        catch { }
    }

    static string JoinArgs(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append('"');
            int slashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
                else { sb.Append('\\', slashes); sb.Append(c); }
                slashes = 0;
            }
            sb.Append('\\', slashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }
}
