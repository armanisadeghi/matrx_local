fn main() {
    // whisper-cpp-plus-sys builds whisper.cpp via cmake, which detects and enables
    // OpenMP on Linux. We must explicitly link libgomp so the linker resolves
    // GOMP_parallel, omp_get_thread_num, etc.
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-lib=gomp");

    tauri_build::build()
}
