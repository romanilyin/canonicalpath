plugins {
    kotlin("jvm") version "1.9.24"
}

group = "com.canonicalpath"
version = "0.1.0"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(17)
}
