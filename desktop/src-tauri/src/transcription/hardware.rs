use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, Serialize)]
pub struct HardwareProfile {
    pub total_ram_mb: u64,
    pub cpu_threads: usize,
    pub gpu_vram_mb: Option<u64>,
    pub supports_cuda: bool,
    pub supports_metal: bool,
    pub is_apple_silicon: bool,
}

impl HardwareProfile {
    pub fn detect() -> Self {
        let mut sys = System::new();
        sys.refresh_memory();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::new());

        let total_ram_mb = sys.total_memory() / 1024 / 1024;
        let cpu_threads = sys.cpus().len();

        let is_apple_silicon = detect_apple_silicon();
        let (gpu_vram_mb, supports_cuda) = detect_gpu_capabilities();

        // Metal is available on all macOS (10.11+)
        let supports_metal = cfg!(target_os = "macos");

        HardwareProfile {
            total_ram_mb,
            cpu_threads,
            gpu_vram_mb,
            supports_cuda,
            supports_metal,
            is_apple_silicon,
        }
    }
}

fn detect_apple_silicon() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("uname")
            .arg("-m")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("arm64"))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Best-effort GPU detection for NVIDIA CUDA.
/// Returns (vram_mb, supports_cuda).
fn detect_gpu_capabilities() -> (Option<u64>, bool) {
    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(output) = std::process::Command::new("nvidia-smi")
            .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = text.lines().next() {
                    if let Ok(mb) = line.trim().parse::<u64>() {
                        return (Some(mb), true);
                    }
                }
            }
        }
        (None, false)
    }
    #[cfg(target_os = "macos")]
    {
        (None, false)
    }
}
