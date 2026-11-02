param([string]$Action, [int]$ProcessId = 0, [string]$Out = '')
# windows <pid>: titles of the visible top-level windows of a process (one per line)
# shot <out.png>: screenshot of the whole desktop (game window and any error dialog on top of it)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class GW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  public static IntPtr MainWindow(uint want) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want && IsWindowVisible(h) && found == IntPtr.Zero) found = h;
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static List<string> Titles(uint want) {
    var r = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want && IsWindowVisible(h)) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        r.Add(c.ToString() + "|" + t.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
[void][GW]::SetProcessDPIAware()
if ($Action -eq 'windows') {
  [GW]::Titles([uint32]$ProcessId) | ForEach-Object { Write-Output $_ }
} elseif ($Action -eq 'shot') {
  # Only the monitor the game window is on (with any dialog the game shows on top), never the other screens.
  $h = [GW]::MainWindow([uint32]$ProcessId)
  if ($h -eq [IntPtr]::Zero) { Write-Output 'no game window'; exit 1 }
  $mi = New-Object GW+MONITORINFO; $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
  [void][GW]::GetMonitorInfo([GW]::MonitorFromWindow($h, 2), [ref]$mi)
  $r = $mi.rcMonitor; $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "$w x $hh"
}
