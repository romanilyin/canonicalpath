cmake_minimum_required(VERSION 3.20)

project(canonicalpath_cpp LANGUAGES CXX)

add_library(canonicalpath_cpp
  src/canonicalpath.cpp
)

target_include_directories(canonicalpath_cpp PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(canonicalpath_cpp PRIVATE cxx_std_20)
