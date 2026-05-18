plugins {
    kotlin("jvm") version "1.9.24"
}

group = "com.canonicalpath"
version = "2026.5.18-1"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(17)
}
